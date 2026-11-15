"""Topografía de toda la Tierra en celdas de 0.05° a partir de COP-DEM GLO-90.

Cada tesela de 1° se descarga, se resume en 20 × 20 celdas y se descarta: solo se guarda
el resumen (unos KB), así que la pasada global no ocupa disco y se puede reanudar.

Por celda se calculan las mismas métricas que en los sitios de la Luna y Marte, a dos
resoluciones para compararlas con cada cuerpo con la misma escala de píxel:
  - fina (~90 m, como LOLA a 120 m): desnivel, % pendiente < 15°, % sin obstáculos (20 m)
  - gruesa (~460 m, como MOLA a 463 m): desnivel, % pendiente < 5°, % sin obstáculos (50 m)
"""

import math
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import rasterio
import requests

from ..metrics import local_relief_m, obstacle_limit_m, slope_limit_deg
from ..raster import GDAL_ENV, _with_retries
from . import grid

FIELDS = ["land", "p2_fine", "p98_fine", "safe_fine", "free_fine",
          "p2_coarse", "p98_coarse", "safe_coarse", "free_coarse"]
METERS_PER_DEG = 111_320.0


def _tile_names(cfg: dict, cache_dir: Path) -> list[str]:
    """Teselas existentes de COP-DEM 90 m (el océano no tiene teselas)."""
    listing = cache_dir / "cop_dem90_tiles.txt"
    if not listing.exists():
        listing.parent.mkdir(parents=True, exist_ok=True)
        listing.write_text(requests.get(cfg["earthGrid"]["copDem90"]["tileList"], timeout=60).text)
    return listing.read_text().split()


def _tile_corner(name: str) -> tuple[int, int]:
    """Esquina suroeste (lat, lon) de una tesela por su nombre."""
    # Copernicus_DSM_COG_30_N37_00_E029_00_DEM
    parts = name.split("_")
    lat = int(parts[4][1:]) * (1 if parts[4][0] == "N" else -1)
    lon = int(parts[6][1:]) * (1 if parts[6][0] == "E" else -1)
    return lat, lon


def _slopes(dem: np.ndarray, dy_m: float, dx_m: np.ndarray) -> np.ndarray:
    """Pendiente en grados con píxeles rectangulares (el ancho cambia con la latitud)."""
    dz_dy = np.gradient(dem, axis=0) / dy_m
    dz_dx = np.gradient(dem, axis=1) / dx_m[:, None]
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def _block_mean(dem: np.ndarray, k: int) -> np.ndarray:
    """Promedio por bloques de k × k píxeles (el DEM visto a k veces menos resolución)."""
    h, w = dem.shape
    return np.nanmean(dem[: h - h % k, : w - w % k].reshape(h // k, k, w // k, k), axis=(1, 3))


def _per_cell(values: np.ndarray, cell_ids: np.ndarray, reducer) -> np.ndarray:
    """Aplica `reducer` a los píxeles válidos de cada una de las 400 celdas de la tesela.

    Si los píxeles se reparten en bloques iguales (casi siempre) se hace de una vez con
    numpy; si no (teselas polares estrechas), celda por celda.
    """
    n = grid.CELLS_PER_DEG
    h, w = values.shape
    if h % n == 0 and w % n == 0:
        blocks = values.reshape(n, h // n, n, w // n).transpose(0, 2, 1, 3).reshape(n, n, -1)
        return reducer(blocks, axis=2).astype("float32")
    out = np.full(grid.CELLS_PER_DEG ** 2, np.nan, dtype="float32")
    flat, ids = values.ravel(), cell_ids.ravel()
    order = np.argsort(ids, kind="stable")
    bounds = np.searchsorted(ids[order], np.arange(out.size + 1))
    for cell in range(out.size):
        chunk = flat[order[bounds[cell]:bounds[cell + 1]]]
        chunk = chunk[~np.isnan(chunk)]
        if chunk.size:
            out[cell] = reducer(chunk, axis=0)
    return out.reshape(grid.CELLS_PER_DEG, grid.CELLS_PER_DEG)


def _pct(values: np.ndarray, axis: int) -> np.ndarray:
    """Porcentaje de verdaderos (1.0) entre los píxeles con dato."""
    return 100 * np.nanmean(values, axis=axis)


def _p2(values: np.ndarray, axis: int) -> np.ndarray:
    """Percentil 2, ignorando píxeles sin dato."""
    return np.nanpercentile(values, 2, axis=axis)


def _p98(values: np.ndarray, axis: int) -> np.ndarray:
    """Percentil 98, ignorando píxeles sin dato."""
    return np.nanpercentile(values, 98, axis=axis)


def _cell_ids(shape: tuple[int, int]) -> np.ndarray:
    """Celda (0–399) de cada píxel de una tesela de 1°."""
    h, w = shape
    rows = (np.arange(h) * grid.CELLS_PER_DEG // h)[:, None]
    cols = (np.arange(w) * grid.CELLS_PER_DEG // w)[None, :]
    return rows * grid.CELLS_PER_DEG + cols


def _summarize(dem: np.ndarray, lat0: int, cfg: dict) -> dict[str, np.ndarray]:
    """Resume una tesela en las métricas por celda, a resolución fina y gruesa."""
    th = cfg["thresholds"]
    h, w = dem.shape
    lat_rows = lat0 + 1 - (np.arange(h) + 0.5) / h
    dy = METERS_PER_DEG / h
    dx = METERS_PER_DEG / w * np.cos(np.radians(lat_rows))
    k = cfg["earthGrid"]["coarseBlockPx"]
    coarse = _block_mean(dem, k)
    out = {"land": _per_cell(np.isfinite(dem).astype("float32"), _cell_ids(dem.shape), _pct)}
    out["land"] = np.nan_to_num(out["land"])

    for tag, d, ddy, ddx in (("fine", dem, dy, dx), ("coarse", coarse, dy * k, dx[: h - h % k : k] * k)):
        res = float(ddy)
        ids = _cell_ids(d.shape)
        slope = _slopes(d, ddy, ddx)
        safe = np.where(np.isnan(slope), np.nan, slope < slope_limit_deg(res, th["slopeLimitDeg"]))
        lr = local_relief_m(d)
        free = np.where(np.isnan(lr), np.nan, lr <= obstacle_limit_m(res, th["obstacleLocalReliefM"]))
        out[f"p2_{tag}"] = _per_cell(d, ids, _p2)
        out[f"p98_{tag}"] = _per_cell(d, ids, _p98)
        out[f"safe_{tag}"] = _per_cell(safe.astype("float32"), ids, _pct)
        out[f"free_{tag}"] = _per_cell(free.astype("float32"), ids, _pct)
    return out


def _process_tile(name: str, cfg: dict, out_dir: Path) -> str:
    """Descarga, resume y guarda una tesela; si ya está hecha, no hace nada."""
    target = out_dir / f"{name}.npz"
    if target.exists():
        return "cached"
    url = cfg["earthGrid"]["copDem90"]["tileUrl"].format(name=name)

    def read():
        with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{url}") as src:
            return src.read(1).astype("float64")

    dem = _with_retries(read)
    # Celdas todo mar o todo sin dato generan avisos de "slice vacío" esperados
    warnings.simplefilter("ignore", RuntimeWarning)
    # En COP-DEM el mar vale exactamente 0 m: no es terreno
    dem[dem == 0] = np.nan
    lat0, _ = _tile_corner(name)
    np.savez_compressed(target, **_summarize(dem, lat0, cfg))
    return "done"


def run(cfg: dict, cache_dir: Path, bbox: tuple[float, float, float, float] | None = None) -> Path:
    """Procesa las teselas (todas o las de `bbox` = oeste, sur, este, norte) y arma la malla."""
    out_dir = Path(cfg["earthGrid"]["tileCacheDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    names = _tile_names(cfg, cache_dir)
    if bbox:
        w, s, e, n = bbox
        names = [t for t in names
                 if s - 1 < _tile_corner(t)[0] < n and w - 1 < _tile_corner(t)[1] < e]

    print(f"  {len(names)} teselas")
    failed = []
    # Procesos y no hilos: el cálculo por tesela es de CPU y los hilos se estorbarían
    with ProcessPoolExecutor(cfg["earthGrid"]["workers"]) as pool:
        futures = {pool.submit(_process_tile, t, cfg, out_dir): t for t in names}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                future.result()
            except Exception as error:  # noqa: BLE001 — una tesela fallida no detiene la pasada
                failed.append(futures[future])
                print(f"  ! {futures[future]}: {type(error).__name__}: {error}")
            if i % 200 == 0 or i == len(names):
                print(f"  {i}/{len(names)} teselas")
    if failed:
        print(f"  {len(failed)} teselas fallaron; vuelve a ejecutar para reintentarlas")
    return assemble(cfg)


def assemble(cfg: dict) -> Path:
    """Une los resúmenes de todas las teselas procesadas en la malla global."""
    out_dir = Path(cfg["earthGrid"]["tileCacheDir"])
    earth = grid.empty(FIELDS)
    for path in out_dir.glob("*.npz"):
        lat0, lon0 = _tile_corner(path.stem)
        rows, cols = grid.tile_slice(lat0, lon0)
        with np.load(path) as part:
            for field in FIELDS:
                earth[field][rows, cols] = part[field]
    target = Path(cfg["earthGrid"]["file"])
    existing = grid.load(target) if target.exists() else {}
    grid.save(target, {**existing, **earth})
    return target
