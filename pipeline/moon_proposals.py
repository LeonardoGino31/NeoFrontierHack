"""Propuestas propias de sitios para una base en el polo sur lunar, a partir de datos LOLA.

Recorre toda la región de 75° a 90° S en bloques de 5 km (la ventana de los sitios
lunares) y se queda con los que cumplen a la vez:
  - luz solar en el mejor punto del bloque ≥ `minSunlightPct`
  - Tierra visible en ese punto ≥ el mínimo del requisito (comunicación directa)
  - pendiente segura ≥ `minSafeSlopePct`
  - sombra permanente (posible hielo) a menos de `maxIceDistanceKm`
Los ordena por luz solar y Tierra visible, y devuelve los mejores separados entre sí.
"""

from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds

from .metrics import local_relief_m, obstacle_limit_m
from .raster import GDAL_ENV, _download

BLOCK_PX = 42  # 42 × 120 m ≈ 5 km


def _local(url: str, cache_dir: Path) -> Path:
    """Copia local del archivo (estos mapas pesan de 1 a 83 MB; se bajan una vez)."""
    path = cache_dir / "files" / url.rsplit("/", 1)[-1]
    if not path.exists():
        print(f"  · descargando {path.name}")
        _download(url, path)
    return path


def _read_scaled(path: Path, source: dict) -> tuple[np.ndarray, rasterio.Affine, object]:
    """Mapa completo en valores físicos (DN × scale + offset), con su transformación y CRS."""
    with rasterio.open(path) as src:
        dn = src.read(1, masked=True).astype("float32")
        return (dn * source["scale"] + source["offset"]).filled(np.nan), src.transform, src.crs


def _dem_on_grid(url: str, transform, shape, cache_dir: Path) -> np.ndarray:
    """DEM del polo sur leído solo en la región de los mapas (misma malla de 120 m)."""
    cached = cache_dir / "files" / "moon_south_dem_75S_120m.npy"
    if cached.exists():
        return np.load(cached)
    h, w = shape
    left, top = transform.c, transform.f
    bounds = (left, top - h * abs(transform.e), left + w * transform.a, top)
    print("  · leyendo el DEM polar (solo 75°–90° S)")
    with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{url}") as src:
        dem = src.read(1, window=from_bounds(*bounds, src.transform), out_shape=shape,
                       masked=True).astype("float32").filled(np.nan)
    np.save(cached, dem)
    return dem


def _blocks(a: np.ndarray, k: int = BLOCK_PX) -> np.ndarray:
    """Vista (filas, columnas, píxeles) de la matriz en bloques de k × k."""
    r, c = a.shape[0] // k, a.shape[1] // k
    return a[: r * k, : c * k].reshape(r, k, c, k).transpose(0, 2, 1, 3).reshape(r, c, k * k)


def propose(cfg: dict, cache_dir: Path, model: dict) -> list[dict]:
    """Bloques de 5 km que mejor cumplen los criterios de base lunar, como objetivos."""
    src = cfg["sources"]
    rules = cfg["moonProposals"]
    sun, transform, crs = _read_scaled(_local(src["moonSunlight"]["url"], cache_dir), src["moonSunlight"])
    earth, _, _ = _read_scaled(_local(src["moonEarthView"]["url"], cache_dir), src["moonEarthView"])
    psr, _, _ = _read_scaled(_local(src["moonPsr"]["url"], cache_dir), src["moonPsr"])
    dem = _dem_on_grid(src["lolaPolarDem"]["url"], transform, sun.shape, cache_dir)

    res = abs(transform.a)
    with np.errstate(all="ignore"):
        dz_dy, dz_dx = np.gradient(dem, res)
        safe = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy))) < 15
        free = local_relief_m(dem) <= obstacle_limit_m(res, cfg["thresholds"]["obstacleLocalReliefM"])

        sun_b, earth_b = _blocks(sun), _blocks(earth)
        best = np.nanargmax(np.where(np.isnan(sun_b), -1, sun_b), axis=2)
        take = lambda b: np.take_along_axis(b, best[..., None], axis=2)[..., 0]  # noqa: E731
        sun_best, earth_best = 100 * take(sun_b), 100 * take(earth_b)
        safe_pct = 100 * _blocks(safe.astype("float32")).mean(axis=2)
        free_pct = 100 * _blocks(free.astype("float32")).mean(axis=2)
        dem_b = _blocks(dem)
        relief = np.nanpercentile(dem_b, 98, axis=2) - np.nanpercentile(dem_b, 2, axis=2)
        has_psr = (_blocks(psr) >= 0.5).any(axis=2)

    # Sombra permanente cerca: algún bloque con PSR a ≤ N bloques de distancia
    reach = max(1, round(rules["maxIceDistanceKm"] / (BLOCK_PX * res / 1000)))
    near_ice = np.zeros_like(has_psr)
    for dr in range(-reach, reach + 1):
        for dc in range(-reach, reach + 1):
            near_ice |= np.roll(np.roll(has_psr, dr, axis=0), dc, axis=1)

    min_earth = model["bodies"]["moon"]["requirement"]["min"]
    ok = ((sun_best >= rules["minSunlightPct"]) & (earth_best >= min_earth)
          & (safe_pct >= rules["minSafeSlopePct"]) & near_ice)
    rows, cols = np.nonzero(ok)
    order = np.lexsort((-earth_best[rows, cols], -sun_best[rows, cols]))
    to_lonlat = Transformer.from_crs(crs, "+proj=longlat +R=1737400 +no_defs", always_xy=True)

    picked, out = [], []
    min_blocks = rules["minSeparationKm"] / (BLOCK_PX * res / 1000)
    for i in order:
        r, c = rows[i], cols[i]
        if any(np.hypot(r - pr, c - pc) < min_blocks for pr, pc in picked):
            continue
        picked.append((r, c))
        x = transform.c + (c + 0.5) * BLOCK_PX * transform.a
        y = transform.f + (r + 0.5) * BLOCK_PX * transform.e
        lon, lat = to_lonlat.transform(x, y)
        out.append({
            "id": f"lola_base_{len(out) + 1}", "body": "moon",
            "name": f"Propuesta LOLA {len(out) + 1}", "lat": round(lat, 4), "lon": round(lon, 4),
            "origin": "Propuesta propia: análisis de iluminación, Tierra visible, pendiente y sombra permanente (LOLA)",
            "evidence": {"sunlightPct": round(float(sun_best[r, c]), 1),
                         "earthViewPct": round(float(earth_best[r, c]), 1),
                         "safeSlopePct": round(float(safe_pct[r, c]), 1),
                         "craterFreePct": round(float(free_pct[r, c]), 1),
                         "reliefM": round(float(relief[r, c]))},
        })
        if len(out) == rules["count"]:
            break
    print(f"  {int(ok.sum())} bloques de 5 km cumplen los criterios; se proponen {len(out)}")
    return out
