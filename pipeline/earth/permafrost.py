"""Permafrost de la Tierra (Obu et al., ESA GlobPermafrost) en la malla de 0.05°.

Dos mapas de probabilidad de permafrost a 1 km (fracción 0–1): el del hemisferio norte
(2000–2016) y el de la Antártida (2000–2017, solo afloramientos sin hielo). Se promedian
en cada celda y se guardan en % como capa `permafrost`; fuera de su cobertura queda NaN.

El permafrost es el análogo directo del hielo enterrado de Marte y de la Luna: sin él, los
desiertos fríos sin nieve (Valles Secos de McMurdo, Devon) salían sin hielo.
"""

import zipfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from ..raster import _download
from . import grid


def _geotiff(url: str, cache_dir: Path) -> Path:
    """Descarga el zip (una vez) y devuelve el GeoTIFF de probabilidad que contiene."""
    name = url.rsplit("/", 1)[-1]
    # Sin with_suffix: el nombre trae "5.0" y se tomaría ese punto como el de la extensión
    archive = cache_dir / "earth" / "permafrost" / name
    folder = archive.parent / name.removesuffix(".zip")
    if not archive.exists():
        print(f"  · descargando {archive.name}")
        _download(url, archive)
    tifs = sorted(folder.glob("**/*.tif"))
    if not tifs:
        with zipfile.ZipFile(archive) as z:
            # Solo los GeoTIFF: el resto del zip (metadatos) no hace falta
            members = [m for m in z.namelist() if m.lower().endswith(".tif") and ".." not in m]
            z.extractall(folder, members)
        tifs = sorted(folder.glob("**/*.tif"))
    if len(tifs) != 1:
        raise ValueError(f"se esperaba un GeoTIFF en {archive.name}, hay {len(tifs)}")
    return tifs[0]


def _to_grid(path: Path) -> np.ndarray:
    """Probabilidad (0–1) promediada en las celdas de 0.05°; NaN fuera del mapa."""
    out = np.full((grid.ROWS, grid.COLS), np.nan, dtype="float32")
    with rasterio.open(path) as src:
        reproject(source=rasterio.band(src, 1), destination=out,
                  dst_transform=from_origin(-180, 90, grid.CELL_DEG, grid.CELL_DEG), dst_crs="EPSG:4326",
                  dst_nodata=np.nan, resampling=Resampling.average)
    return out


def run(cfg: dict, cache_dir: Path) -> Path:
    """Agrega la capa `permafrost` (%) a la malla y recalcula el índice de hielo."""
    target = Path(cfg["earthGrid"]["file"])
    earth = grid.load(target)
    layer = np.full((grid.ROWS, grid.COLS), np.nan, dtype="float32")
    for region in cfg["sources"]["earthPermafrost"]["regions"]:
        print(f"  · {region['name']}")
        part = 100 * _to_grid(_geotiff(region["url"], cache_dir))
        # Los mapas no se solapan (norte y Antártida): cada uno aporta sus celdas
        layer = np.where(np.isnan(layer), part, layer)
    earth["permafrost"] = layer
    grid.combine_ice(earth)
    grid.save(target, earth)
    return target
