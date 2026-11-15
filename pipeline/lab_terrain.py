"""Terreno real de cada punto para el laboratorio 3D.

Para cada punto del CSV (candidato en la Luna o Marte y, si lo tiene, su análogo en la Tierra) lee un
recorte de 20 × 20 km del modelo de elevación y de la imagen orbital, ambos reproyectados
a la misma malla local que usa el laboratorio (241 × 241 vértices, norte arriba).

Salida en public/data/lab/:
    index.json      lista de puntos, fuentes y valores medidos del CSV
    <clave>.bin     alturas en uint16 (min + v / 65535 × (max − min) metros), fila 0 = norte
    <clave>.jpg     imagen orbital del mismo recorte
"""

import csv
import json
import math
import re
import subprocess
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds, from_origin
from rasterio.vrt import WarpedVRT

from .raster import GDAL_ENV, _local_crs, _with_retries, read_window
from .sites import Site, is_candidate_only, load_sites
from .sources.dem import dem_source

GRID = 241                   # vértices por lado de la malla del laboratorio
SIZE_KM = 20.0               # lado del terreno del laboratorio
RES_M = SIZE_KM * 1000 / (GRID - 1)
WINDOW_KM = GRID * RES_M / 1000  # read_window cuenta píxeles, no vértices
IMAGE_PX = {"earth": 1024, "moon": 512, "mars": 512}

ASC = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic"
IMAGERY = {
    "moon": {"dataset": "LRO WAC global mosaic 100 m (USGS Astrogeology)",
             "url": f"{ASC}/Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif"},
    "mars": {"dataset": "Viking MDIM 2.1 color 232 m + THEMIS IR día 100 m (USGS Astrogeology)",
             "url": f"{ASC}/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif",
             "detail": f"{ASC}/Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif"},
    "earth": {"dataset": "Sentinel-2 cloudless 2020 (EOX IT Services, CC BY-NC-SA 4.0)",
              "url": "https://tiles.maps.eox.at/wms", "params": {"layers": "s2cloudless-2020"}},
}
# s2cloudless no tiene imagen de la Antártida (la rellena de blanco liso): ahí se usa MODIS de
# un día del verano austral, con el sol más alto y sin noche polar
EARTH_FALLBACK = {"dataset": "MODIS Terra reflectancia corregida, 15-12-2020 (NASA GIBS)",
                  "url": "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
                  "params": {"layers": "MODIS_Terra_CorrectedReflectance_TrueColor", "time": "2020-12-15",
                             "styles": ""}}

# Los mosaicos de USGS no son COG y S3 a veces deja una conexión colgada: sin tiempo límite
# GDAL esperaría para siempre. Con él, la lectura falla y _with_retries la repite.
HTTP_ENV = {**GDAL_ENV, "GDAL_HTTP_TIMEOUT": "60", "GDAL_HTTP_MAX_RETRY": "4", "GDAL_HTTP_RETRY_DELAY": "3"}

# Valores medidos que muestra el panel: clave → columna del CSV sin el sufijo _earth/_analog
METRICS = ["sunlight", "albedo", "relief", "safe_slope", "crater_free", "soil_stability", "ice",
           "ice_confidence"]


def _key(site) -> str:
    """Nombre de archivo estable para el punto."""
    return re.sub(r"[^a-z0-9_-]", "_", f"{site.body}_{site.id}".lower())


def _warp_bands(path: str, lat: float, lon: float, px: int, resampling: Resampling) -> np.ndarray:
    """Todas las bandas de la fuente en la malla local del sitio (bandas, px, px); sin dato = NaN."""
    res = WINDOW_KM * 1000 / px
    half = WINDOW_KM * 1000 / 2
    with rasterio.Env(**HTTP_ENV), rasterio.open(path) as src:
        with WarpedVRT(src, crs=_local_crs(src.crs, lat, lon), transform=from_origin(-half, half, res, res),
                       width=px, height=px, resampling=resampling, src_nodata=src.nodata or 0,
                       nodata=0) as vrt:
            data = vrt.read(masked=True).astype("float64")
    return data.filled(np.nan)


def _fill_nan(a: np.ndarray, fallback: float) -> np.ndarray:
    """Rellena huecos con la media (o `fallback` si no hay ningún dato): la malla no admite NaN."""
    if np.isnan(a).all():
        return np.full_like(a, fallback)
    return np.where(np.isnan(a), np.nanmean(a), a)


def _dem(site, cfg: dict, cache_dir: Path) -> tuple[np.ndarray, str]:
    """Alturas (m) de la ventana del laboratorio y nombre del dataset."""
    # La ventana de COP-DEM depende de pair_body; se pide la del laboratorio
    cfg = {**cfg, "windows": {**cfg["windows"], site.pair_body: {"sizeKm": WINDOW_KM, "resolutionM": RES_M}}}
    urls, dataset = dem_source(site, cfg, cache_dir)
    # Luna y Marte tienen menos resolución que la malla: cúbica evita los escalones
    resampling = Resampling.average if site.body == "earth" else Resampling.cubic
    dem = read_window(urls, site.lat, site.lon, WINDOW_KM, RES_M, cache_dir, resampling=resampling)
    # Las teselas de océano no existen en COP-DEM: ahí el nivel del mar es lo correcto
    return _fill_nan(dem, 0.0), dataset["dataset"] if isinstance(dataset, dict) else dataset


def _earth_image(lat: float, lon: float, px: int, source: dict) -> np.ndarray:
    """Recorte de una capa WMS (`source`) pedido en lat/lon y reproyectado a la malla local."""
    half_lat = math.degrees(WINDOW_KM * 0.75 / 6371.0)  # margen: la reproyección gira el recuadro
    half_lon = min(179.0, half_lat / max(0.02, math.cos(math.radians(lat))))
    south, north = max(-90.0, lat - half_lat), min(90.0, lat + half_lat)
    west, east = lon - half_lon, lon + half_lon
    params = {"service": "WMS", "request": "GetMap", "version": "1.1.1", **source["params"],
              "srs": "EPSG:4326", "bbox": f"{west},{south},{east},{north}", "width": 2048,
              "height": 2048, "format": "image/png"}
    for attempt in range(1, 5):
        try:
            response = requests.get(source["url"], params=params, timeout=120)
            response.raise_for_status()
            break
        except requests.RequestException:
            # Los WMS cortan la conexión de vez en cuando con imágenes de 2048 px
            if attempt == 4:
                raise
            time.sleep(3 * attempt)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)  # el PNG del WMS no trae georreferencia
        png = MemoryFile(response.content)
        raw = png.open()
    with png, raw:
        rgb = raw.read([1, 2, 3])
    profile = {"driver": "GTiff", "width": 2048, "height": 2048, "count": 3, "dtype": "uint8",
               "crs": "EPSG:4326", "transform": from_bounds(west, south, east, north, 2048, 2048)}
    with MemoryFile() as mem:
        with mem.open(**profile) as dst:
            dst.write(rgb)
        return _warp_bands(mem.name, lat, lon, px, Resampling.bilinear)


def _box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Media móvil cuadrada de radio `r` (con bordes replicados)."""
    p = np.pad(a, r, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def _image(site) -> tuple[np.ndarray, str]:
    """Imagen RGB (3, px, px) en [0, 255] del recorte del sitio y el dataset del que sale."""
    px = IMAGE_PX[site.body]
    if site.body == "earth":
        for source in (IMAGERY["earth"], EARTH_FALLBACK):
            # Las celdas negras puras salen como "sin dato" del warp: se rellenan con la media
            img = np.stack([_fill_nan(b, 120.0) for b in _earth_image(site.lat, site.lon, px, source)])
            if img.std() > 2:  # una imagen lisa es un relleno, no una observación
                break
        return img, source["dataset"]
    src = IMAGERY[site.body]
    read = lambda url: _with_retries(lambda: _warp_bands(f"/vsicurl/{url}", site.lat, site.lon, px,
                                                         Resampling.bilinear))
    img = read(src["url"])
    if img.shape[0] == 1:
        img = np.repeat(img, 3, axis=0)
    img = np.stack([_fill_nan(b, 90.0) for b in img])
    if "detail" in src:
        # Viking da el color real pero a 232 m; THEMIS aporta la forma del relieve a 100 m.
        # Solo se toma su detalle (alta frecuencia), así el color sigue siendo el de Viking.
        themis = read(src["detail"])[0]
        if np.isfinite(themis).mean() > 0.9:
            themis = _fill_nan(themis, 128.0)
            ratio = (themis + 8) / (_box_blur(themis, 6) + 8)
            img = img * np.clip(1 + (ratio - 1) * 0.5, 0.7, 1.4)
    return np.clip(img, 0, 255), src["dataset"]


def _write_jpeg(rgb: np.ndarray, out: Path) -> None:
    """Guarda (3, h, w) como JPEG con ImageMagick (evita sumar Pillow a las dependencias)."""
    h, w = rgb.shape[1:]
    raw = np.ascontiguousarray(rgb.transpose(1, 2, 0).round().astype(np.uint8)).tobytes()
    subprocess.run(["magick", "-size", f"{w}x{h}", "-depth", "8", "rgb:-", "-strip", "-quality", "86",
                    str(out)], input=raw, check=True)


def _csv_rows(csv_path: Path) -> list[dict]:
    """Todas las filas del CSV (parejas y candidatos sueltos)."""
    with csv_path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _all_sites(csv_path: Path, rows: list[dict]) -> list[Site]:
    """Puntos de las parejas más los candidatos que aún no tienen pareja en la Tierra."""
    sites = {f"{s.body}:{s.id}": s for s in load_sites(csv_path)}
    for row in rows:
        if is_candidate_only(row):
            site = Site(row["candidate_id"], row["body"], row["body"], row["analog_site_name"],
                        float(row["analog_latitude"]), float(row["analog_longitude"]))
            sites.setdefault(f"{site.body}:{site.id}", site)
    return list(sites.values())


def _metrics(row: dict, side: str) -> dict:
    """Valores del CSV de un lado de la pareja ('earth' o 'analog'); vacío = sin dato."""
    out = {}
    for m in METRICS:
        v = row.get(f"{m}_{side}", "")
        out[m] = float(v) if v not in ("", None) else None
    return out


def _export_one(site, cfg: dict, cache_dir: Path, out_dir: Path, previous: dict) -> dict:
    """Escribe alturas e imagen de un sitio y devuelve su entrada del índice.

    `previous` son las entradas del índice anterior: dicen de qué dataset salió una imagen
    que ya existe y no se vuelve a descargar.
    """
    key = _key(site)
    dem, dem_dataset = _dem(site, cfg, cache_dir)
    lo, hi = float(dem.min()), float(dem.max())
    q = np.round((dem - lo) / max(hi - lo, 1e-6) * 65535).astype("<u2")
    (out_dir / f"{key}.bin").write_bytes(q.tobytes())

    image_path = out_dir / f"{key}.jpg"
    # Sin índice anterior, una imagen existente sale de la fuente principal del cuerpo
    image_dataset = previous.get(key, {}).get("imageDataset") or IMAGERY[site.body]["dataset"]
    if not image_path.exists():
        rgb, image_dataset = _image(site)
        _write_jpeg(rgb, image_path)
    print(f"  · {key}: {lo:.0f}–{hi:.0f} m")
    return {"key": key, "id": site.id, "body": site.body, "name": site.name, "lat": site.lat,
            "lon": site.lon, "minM": round(lo, 2), "maxM": round(hi, 2),
            "demDataset": dem_dataset, "imageDataset": image_dataset}


def _export_safe(site, cfg: dict, cache_dir: Path, out_dir: Path, previous: dict) -> dict | None:
    """Como _export_one, pero un punto que falla tres veces se omite en lugar de cortar la ejecución."""
    for attempt in range(1, 4):
        try:
            return _export_one(site, cfg, cache_dir, out_dir, previous)
        except Exception as err:  # S3 devuelve a veces bloques truncados; otra pasada suele bastar
            print(f"  ! {site.body}:{site.id} intento {attempt}: {err}")
            time.sleep(10 * attempt)
    print(f"  ! {site.body}:{site.id} omitido")
    return None


def run(cfg: dict, cache_dir: Path, csv_path: Path, out_dir: Path, workers: int = 4) -> Path:
    """Exporta todos los puntos de las parejas del CSV y escribe el índice."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = _csv_rows(csv_path)
    sites = _all_sites(csv_path, rows)
    path = out_dir / "index.json"
    previous = ({e["key"]: e for e in json.loads(path.read_text(encoding="utf-8"))["sites"]}
                if path.exists() else {})
    # Los mosaicos de USGS no son COG: cada lectura tarda; en paralelo se solapan las esperas
    with ThreadPoolExecutor(workers) as pool:
        entries = [e for e in pool.map(lambda s: _export_safe(s, cfg, cache_dir, out_dir, previous), sites) if e]
    by_key = {(e["body"], e["id"]): e for e in entries}

    for row in rows:
        analog = by_key.get((row["body"], row["candidate_id"]))
        if analog is None:
            continue
        if is_candidate_only(row):
            # Un candidato con pareja ya tiene sus valores desde la fila de la pareja
            analog.setdefault("values", _metrics(row, "analog"))
            continue
        earth = by_key.get(("earth", row["earth_site_id"]))
        if earth is None:
            continue
        earth.update(region=row["earth_region"], partner=analog["key"], values=_metrics(row, "earth"),
                     dataStatus=row["data_status"])
        analog.update(partner=earth["key"], values=_metrics(row, "analog"), dataStatus=row["data_status"])

    # Los recortes de puntos que ya no están en el CSV solo ocuparían espacio en el repo
    keep = {e["key"] for e in entries}
    for f in [*out_dir.glob("*.bin"), *out_dir.glob("*.jpg")]:
        if f.stem not in keep:
            f.unlink()

    index = {"sizeKm": SIZE_KM, "grid": GRID, "sites": entries}
    path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    return path
