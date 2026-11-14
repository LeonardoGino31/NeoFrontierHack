"""Mapas de iluminación del polo sur lunar (LOLA, PGDA): luz solar, Tierra visible y sombra permanente."""

from pathlib import Path

import numpy as np
from rasterio.enums import Resampling

from ..raster import read_window


def _read(site, cfg: dict, cache_dir: Path, key: str) -> tuple[np.ndarray, dict]:
    """Ventana del mapa `key` en valores físicos, y su cita."""
    source = cfg["sources"][key]
    window = cfg["windows"]["moon"]
    # Vecino más cercano: estos mapas ya están a 120 m y promediar mezclaría sol y sombra
    data = read_window([source["url"]], site.lat, site.lon, window["sizeKm"], window["resolutionM"],
                       cache_dir, scale=source["scale"], offset=source["offset"],
                       resampling=Resampling.nearest)
    return data, {"dataset": source["dataset"], "url": source["url"]}


def polar_illumination(site, cfg: dict, cache_dir: Path) -> dict:
    """Luz solar del mejor punto de la ventana, Tierra visible en ese punto y sombra permanente.

    Una base se instala en el punto más iluminado, así que se toma el máximo y no la media.
    """
    sun, sun_src = _read(site, cfg, cache_dir, "moonSunlight")
    earth, earth_src = _read(site, cfg, cache_dir, "moonEarthView")
    psr, psr_src = _read(site, cfg, cache_dir, "moonPsr")

    best = np.unravel_index(np.nanargmax(sun), sun.shape)
    return {
        "sunlight": {"value": round(100 * float(sun[best]), 1), "unit": "%", "status": "measured",
                     "source": sun_src, "note": "mejor píxel de la ventana"},
        "earthView": {"value": round(100 * float(earth[best]), 1), "unit": "%", "status": "measured",
                      "source": earth_src, "note": "en el píxel con más luz solar"},
        "_permanentShadow": {"value": bool(np.nanmax(psr) >= 0.5), "source": psr_src},
    }
