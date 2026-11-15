"""Luz solar, hielo y suelo de un sitio de la Tierra, leídos de la malla global de MODIS.

Son las mismas capas contra las que la búsqueda compara cada objetivo, así que un sitio del
CSV y una celda candidata se miden igual. Se promedian las celdas de 0.05° que caen dentro
de la ventana de la pareja (5 km para la Luna, 20 km para Marte).
"""

import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..earth import grid

MODIS_URL = "https://ladsweb.modaps.eosdis.nasa.gov/"
PERMAFROST_URL = "https://doi.org/10.1594/PANGAEA.888600"
# métrica -> (unidad, dataset, url, decimales)
LAYERS = {
    "sunlight": ("%", "Día × cielo despejado (MODIS MOD08_M3, 2024)", MODIS_URL, 1),
    "albedo": ("", "Albedo de onda corta, cielo blanco (MODIS MCD43C3, 2024)", MODIS_URL, 3),
    "ice": ("pts", "Nieve (MODIS MOD10CM, 2024) o permafrost (Obu et al., ESA GlobPermafrost)", MODIS_URL, 1),
    "soilStability": ("pts", "Inercia térmica aparente (MODIS MOD11C3 + MCD43C3, 2024)", MODIS_URL, 1),
}


@lru_cache(maxsize=1)
def _load(path: str) -> dict:
    """Malla cargada una sola vez por ejecución (pesa ~150 MB)."""
    return grid.load(Path(path))


def grid_values(site, cfg: dict) -> dict:
    """Valores de MODIS en la ventana del sitio; vacío si la malla aún no tiene esas capas."""
    path = Path(cfg["earthGrid"]["file"])
    if not path.exists():
        return {}
    earth = _load(str(path))
    half_km = cfg["windows"][site.pair_body]["sizeKm"] / 2
    dlat = half_km / 111.32
    dlon = dlat / max(0.05, math.cos(math.radians(site.lat)))
    r0, c0 = grid.cell_index(site.lat + dlat, site.lon - dlon)
    r1, c1 = grid.cell_index(site.lat - dlat, site.lon + dlon)

    def window_mean(key: str) -> float:
        """Promedio de una capa en la ventana; NaN si no hay dato."""
        with np.errstate(all="ignore"):
            return float(np.nanmean(earth[key][r0:r1 + 1, c0:c1 + 1]))

    out = {}
    for key, (unit, dataset, url, decimals) in LAYERS.items():
        value = window_mean(key) if key in earth else math.nan
        if math.isfinite(value):
            out[key] = {"value": round(value, decimals), "unit": unit, "status": "derived",
                        "source": {"dataset": dataset, "url": url},
                        "note": f"promedio de la ventana de {2 * half_km:g} km"}
    if "ice" in out:
        snow = window_mean("snow") if "snow" in earth else out["ice"]["value"]
        permafrost = window_mean("permafrost") if "permafrost" in earth else math.nan
        has_permafrost = math.isfinite(permafrost)
        out["ice"]["note"] = (f"nieve {snow:.0f} pts" + (f", permafrost {permafrost:.0f} %" if has_permafrost else
                              ", sin mapa de permafrost") + f"; ventana de {2 * half_km:g} km")
        if has_permafrost:
            out["ice"]["source"]["url"] = [MODIS_URL, PERMAFROST_URL]
        # Indicadores medidos de los esperados (nieve, permafrost): da la confianza del hielo
        out["_iceIndicatorsMeasured"] = 1 + has_permafrost
    return out
