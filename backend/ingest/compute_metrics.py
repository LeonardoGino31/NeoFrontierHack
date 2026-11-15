"""Calcula desnivel y pendiente segura de cada recorte DEM de data/raw/dem/.

Salida: data/processed/dem_metrics.json (no toca el CSV ni el frontend).

Decisiones (deben repetirse igual para Luna y Marte para que la comparación valga):
- Pendiente segura = % de píxeles con pendiente < SLOPE_LIMIT_DEG (15°).
- Desnivel = percentil 98 − percentil 2 de la elevación (robusto a píxeles aislados).
- Los píxeles con elevación exactamente 0,0 se enmascaran (mar o relleno en Copernicus).
- flat_warning si la desviación estándar es < 3 m: el DEM puede estar suavizado, hay que marcarlo.

Uso (desde la raíz del repo):
    backend/.venv/bin/python backend/ingest/compute_metrics.py
"""
import json
import math
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[2]
DEM_DIR = ROOT / "data" / "raw" / "dem"
OUT = ROOT / "data" / "processed" / "dem_metrics.json"

SLOPE_LIMIT_DEG = 15.0
FLAT_STD_M = 3.0
M_PER_DEG = 111_320.0


def slope_degrees(elev: np.ndarray, res_x_deg: float, res_y_deg: float, lat: float) -> np.ndarray:
    """Pendiente en grados; con NaN en la elevación el resultado es NaN en esos píxeles y sus vecinos."""
    dx = res_x_deg * M_PER_DEG * math.cos(math.radians(lat))
    dy = res_y_deg * M_PER_DEG
    dz_dy, dz_dx = np.gradient(elev, dy, dx)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def metrics_for(path: Path) -> dict:
    with rasterio.open(path) as ds:
        elev = ds.read(1).astype(float)
        res_x, res_y = abs(ds.res[0]), abs(ds.res[1])
        lat = (ds.bounds.top + ds.bounds.bottom) / 2

    masked = elev == 0.0
    elev[masked] = np.nan
    valid = ~np.isnan(elev)
    if valid.sum() < 100:
        return {"error": "sin datos válidos tras enmascarar", "masked_frac": float(masked.mean())}

    slope = slope_degrees(elev, res_x, res_y, lat)
    slope_ok = ~np.isnan(slope)
    p2, p98 = np.nanpercentile(elev, [2, 98])
    std = float(np.nanstd(elev))

    return {
        "relief_m": round(float(p98 - p2), 1),
        "safe_slope_pct": round(float((slope[slope_ok] < SLOPE_LIMIT_DEG).mean() * 100), 1),
        "mean_slope_deg": round(float(np.nanmean(slope)), 2),
        "elev_min_m": round(float(np.nanmin(elev)), 1),
        "elev_max_m": round(float(np.nanmax(elev)), 1),
        "elev_std_m": round(std, 1),
        "masked_frac": round(float(masked.mean()), 3),
        "flat_warning": std < FLAT_STD_M,
        "pixels": int(elev.size),
    }


def main():
    paths = sorted(DEM_DIR.glob("*.tif"))
    if not paths:
        raise SystemExit(f"No hay recortes en {DEM_DIR}. Ejecuta fetch_dem.py primero.")
    result = {
        "source": "Copernicus GLO-30 (30 m)",
        "slope_limit_deg": SLOPE_LIMIT_DEG,
        "sites": {p.stem: metrics_for(p) for p in paths},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"{'sitio':12} {'desnivel_m':>10} {'pend.segura%':>12} {'pend.media°':>11} {'enmasc.':>8}  aviso")
    for sid, m in result["sites"].items():
        if "error" in m:
            print(f"{sid:12} ERROR {m['error']}")
            continue
        note = "PLANO" if m["flat_warning"] else ""
        print(f"{sid:12} {m['relief_m']:10.1f} {m['safe_slope_pct']:12.1f} {m['mean_slope_deg']:11.2f} {m['masked_frac']:8.1%}  {note}")


if __name__ == "__main__":
    main()
