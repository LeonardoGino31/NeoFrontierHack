"""Estabilidad del suelo de la Luna a partir de la abundancia de rocas de Diviner (70° S–70° N).

Diviner deduce la fracción de la superficie cubierta por rocas de su inercia térmica: es
el mismo principio que la inercia térmica aparente de la Tierra (suelo compacto o rocoso =
alta, polvo suelto = baja). Igual que en la Tierra, se escala a 0–100 con los percentiles
5 y 95 de todo el cuerpo, así que el valor es relativo a la Luna.

El mosaico (3.3 GB) se guarda en franjas de una fila: una ventana de 5 km lee ~1 MB.
Los polos quedan fuera de la cobertura: allí la métrica no se calcula.
"""

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

from ..raster import GDAL_ENV, read_window

PERCENTILE_ROW_STEP = 180  # 100 filas repartidas en todo el mosaico bastan para los percentiles


def _percentiles(url: str, cache_dir: Path) -> tuple[float, float]:
    """Percentiles 5 y 95 de la abundancia de rocas de la Luna (se calculan una vez)."""
    cached = cache_dir / "files" / "diviner_ra_percentiles.json"
    if cached.exists():
        p5, p95 = json.loads(cached.read_text())
        return p5, p95
    print("  · percentiles de la abundancia de rocas (muestreo de filas del mosaico)")
    with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{url}") as src:
        rows = [src.read(1, window=Window(0, r, src.width, 1))[0]
                for r in range(0, src.height, PERCENTILE_ROW_STEP)]
    values = np.concatenate(rows).astype("float64")
    p5, p95 = np.percentile(values[np.isfinite(values) & (values >= 0)], [5, 95])
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps([float(p5), float(p95)]))
    return float(p5), float(p95)


def rock_score(rock_fraction: float, p5: float, p95: float) -> float:
    """Abundancia de rocas escalada a 0–100 entre los percentiles 5 y 95 del cuerpo."""
    return float(np.clip(100 * (rock_fraction - p5) / (p95 - p5), 0, 100))


def soil_stability(site, cfg: dict, cache_dir: Path) -> dict:
    """Métrica `soilStability` de un sitio lunar dentro de la cobertura de Diviner."""
    source = cfg["sources"]["moonRockAbundance"]
    if site.body != "moon" or abs(site.lat) > source["maxAbsLatDeg"]:
        return {}
    window = cfg["windows"][site.pair_body]
    data = read_window([source["url"]], site.lat, site.lon, window["sizeKm"], window["resolutionM"], cache_dir)
    with np.errstate(all="ignore"):
        rocks = float(np.nanmean(data))
    if not np.isfinite(rocks):
        return {}
    p5, p95 = _percentiles(source["url"], cache_dir)
    return {"soilStability": {
        "value": round(rock_score(rocks, p5, p95)), "unit": "pts", "status": "derived",
        "note": f"abundancia de rocas {100 * rocks:.2f} %, escalada con los percentiles 5–95 de la Luna",
        "source": {"dataset": source["dataset"], "url": source["url"]},
    }}
