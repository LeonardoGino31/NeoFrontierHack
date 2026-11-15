"""Modelos de elevación de cada cuerpo: relieve, pendiente segura."""

import math
from pathlib import Path

import requests

from ..metrics import (obstacle_free_pct, obstacle_limit_m, relief_m, safe_slope_pct, slope_deg,
                       slope_limit_deg)
from ..raster import read_window


def _cop_dem_tiles(lat: float, lon: float, size_km: float, source: dict, cache_dir: Path) -> list[str]:
    """URLs de las teselas de 1° de COP-DEM que tocan la ventana (sin las de océano)."""
    listing = cache_dir / "cop_dem_tiles.txt"
    if not listing.exists():
        listing.parent.mkdir(parents=True, exist_ok=True)
        listing.write_text(requests.get(source["tileList"], timeout=60).text)
    available = set(listing.read_text().split())

    half_lat = math.degrees(size_km / 2 / 6371.0)
    half_lon = half_lat / max(0.01, math.cos(math.radians(lat)))
    urls = []
    for la in range(math.floor(lat - half_lat), math.floor(lat + half_lat) + 1):
        for lo in range(math.floor(lon - half_lon), math.floor(lon + half_lon) + 1):
            name = (f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_"
                    f"{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM")
            if name in available:
                urls.append(source["tileUrl"].format(name=name))
    if not urls:
        raise ValueError(f"COP-DEM no tiene teselas en ({lat}, {lon}): ¿el sitio está en el mar?")
    return urls


def dem_source(site, cfg: dict, cache_dir: Path) -> tuple[list[str], str]:
    """Fuente de elevación del sitio: URLs a leer y nombre del dataset para citarlo."""
    sources = cfg["sources"]
    if site.body == "earth":
        size_km = cfg["windows"][site.pair_body]["sizeKm"]
        return _cop_dem_tiles(site.lat, site.lon, size_km, sources["copDem"], cache_dir), sources["copDem"]["dataset"]
    if site.body == "mars":
        return [sources["molaDem"]["url"]], sources["molaDem"]["dataset"]
    polar = site.lat < cfg["thresholds"]["moonPolarBelowLatDeg"]
    key = "lolaPolarDem" if polar else "lolaGlobalDem"
    return [sources[key]["url"]], sources[key]["dataset"]


def topography(site, cfg: dict, cache_dir: Path) -> dict:
    """Desnivel y pendiente segura del sitio, con la ventana y resolución de su pareja."""
    window = cfg["windows"][site.pair_body]
    urls, dataset = dem_source(site, cfg, cache_dir)
    dem = read_window(urls, site.lat, site.lon, window["sizeKm"], window["resolutionM"], cache_dir)
    limit = slope_limit_deg(window["resolutionM"], cfg["thresholds"]["slopeLimitDeg"])
    obstacle = obstacle_limit_m(window["resolutionM"], cfg["thresholds"]["obstacleLocalReliefM"])
    source = {"dataset": dataset, "url": urls[0] if len(urls) == 1 else urls}
    return {
        "relief": {"value": round(relief_m(dem)), "unit": "m", "status": "derived", "source": source},
        "safeSlope": {
            "value": round(safe_slope_pct(slope_deg(dem, window["resolutionM"]), limit), 1),
            "unit": "%", "status": "derived", "source": source,
            "note": f"% de píxeles con pendiente < {limit}° a {window['resolutionM']} m/px",
        },
        # Misma regla en los tres cuerpos: obstáculo = desnivel local 3 × 3 mayor que el límite
        "craterFree": {
            "value": round(obstacle_free_pct(dem, obstacle), 1), "unit": "%", "status": "derived",
            "source": source,
            "note": f"% de píxeles con desnivel local ≤ {obstacle} m a {window['resolutionM']} m/px",
        },
    }
