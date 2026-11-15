"""Lectura de ventanas de GeoTIFF remotos sin descargar el archivo completo.

GDAL pide por HTTP solo los bloques que cubren la ventana. Cada ventana se reproyecta
a una malla local de igual área centrada en el sitio, para medir en metros reales.
"""

import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import CRS
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

# El servidor de PGDA falla con peticiones de varios rangos a la vez; en serie funciona.
GDAL_ENV = {"GDAL_HTTP_MULTIRANGE": "SERIAL", "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR"}
RETRIES = 3
# Si la lectura por ventana falla siempre, los archivos pequeños se descargan enteros una vez
FULL_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024


def _local_crs(src_crs, lat: float, lon: float) -> CRS:
    """Proyección azimutal de igual área centrada en el sitio, sobre el mismo cuerpo que la fuente."""
    ellipsoid = CRS.from_user_input(src_crs).ellipsoid
    return CRS.from_proj4(
        f"+proj=laea +lat_0={lat} +lon_0={lon} "
        f"+a={ellipsoid.semi_major_metre} +b={ellipsoid.semi_minor_metre} +units=m +no_defs"
    )


def _read_one(path: str, lat: float, lon: float, size_km: float, resolution_m: float,
              resampling: Resampling) -> np.ndarray:
    """Lee la ventana de una fuente (ruta local o `/vsicurl/<url>`); sin dato = NaN."""
    pixels = max(1, round(size_km * 1000 / resolution_m))
    half = pixels * resolution_m / 2
    with rasterio.Env(**GDAL_ENV), rasterio.open(path) as src:
        # Sin un valor "sin dato", lo que queda fuera de la fuente (otra tesela) saldría como 0 m
        nodata = src.nodata if src.nodata is not None else (
            np.nan if np.issubdtype(np.dtype(src.dtypes[0]), np.floating) else np.iinfo(src.dtypes[0]).min)
        with WarpedVRT(src, crs=_local_crs(src.crs, lat, lon),
                       transform=from_origin(-half, half, resolution_m, resolution_m),
                       width=pixels, height=pixels, resampling=resampling,
                       src_nodata=nodata, nodata=nodata) as vrt:
            data = vrt.read(1, masked=True).astype("float64")
    return data.filled(np.nan)


def read_window(urls: list[str], lat: float, lon: float, size_km: float, resolution_m: float,
                cache_dir: Path, scale: float = 1.0, offset: float = 0.0,
                resampling: Resampling = Resampling.average) -> np.ndarray:
    """Ventana cuadrada de `size_km` a `resolution_m`, combinando varias fuentes (teselas).

    Guarda el resultado en caché para no volver a descargarlo. `scale` y `offset` pasan
    de valores digitales a físicos (valor = DN × scale + offset).
    """
    key = json.dumps([sorted(urls), lat, lon, size_km, resolution_m, resampling.name])
    cached = cache_dir / "windows" / f"{hashlib.sha1(key.encode()).hexdigest()}.npy"
    if cached.exists():
        raw = np.load(cached)
    else:
        raw = None
        for url in urls:
            part = _read_remote(url, lat, lon, size_km, resolution_m, resampling, cache_dir)
            # Las teselas no se solapan: cada una aporta los píxeles que la otra no tiene
            raw = part if raw is None else np.where(np.isnan(raw), part, raw)
        cached.parent.mkdir(parents=True, exist_ok=True)
        # Escribir aparte y renombrar: dos ejecuciones en paralelo nunca leen un archivo a medias
        partial = cached.with_name(f"{cached.stem}.{os.getpid()}.part.npy")
        np.save(partial, raw)
        partial.replace(cached)
    return raw * scale + offset


def _read_remote(url: str, lat: float, lon: float, size_km: float, resolution_m: float,
                 resampling: Resampling, cache_dir: Path) -> np.ndarray:
    """Ventana leída por HTTP; si el servidor falla siempre, usa una copia local del archivo."""
    if Path(url).exists():  # mapas que GDAL solo abre desde disco (etiquetas PDS3)
        return _read_one(url, lat, lon, size_km, resolution_m, resampling)
    local = cache_dir / "files" / url.rsplit("/", 1)[-1]
    if local.exists():
        return _read_one(str(local), lat, lon, size_km, resolution_m, resampling)
    try:
        return _with_retries(lambda: _read_one(f"/vsicurl/{url}", lat, lon, size_km, resolution_m, resampling))
    except RasterioIOError:
        size = int(requests.head(url, allow_redirects=True, timeout=60).headers.get("Content-Length", 0))
        if not 0 < size <= FULL_DOWNLOAD_MAX_BYTES:
            raise
        print(f"  · la lectura por ventana falla; descargando {url} ({size / 1e6:.0f} MB) una sola vez")
        _download(url, local)
        return _read_one(str(local), lat, lon, size_km, resolution_m, resampling)


def _download(url: str, dest: Path) -> None:
    """Descarga un archivo por partes; el .part evita dejar un archivo a medias en caché."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=300) as response:
        response.raise_for_status()
        with partial.open("wb") as f:
            for chunk in response.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    partial.rename(dest)


def _with_retries(read):
    """Reintenta una lectura remota: los servidores fallan de vez en cuando con una ventana."""
    for attempt in range(1, RETRIES + 1):
        try:
            return read()
        except RasterioIOError:
            if attempt == RETRIES:
                raise
            time.sleep(2 * attempt)
