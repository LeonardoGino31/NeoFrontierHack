"""Vista previa (solo lectura): cuánto cambiaría el índice de cada pareja si relief_earth y
safe_slope_earth del CSV se sustituyen por los valores calculados de Copernicus.

No escribe ningún archivo. Uso (desde la raíz del repo):
    backend/.venv/bin/python backend/ingest/preview_merge.py
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from core.features import load_model
from core.similarity import score

METRICS = ROOT / "data" / "processed" / "dem_metrics.json"
CSV_PATH = ROOT / "public" / "data" / "planetary_candidates.csv"


def values(row, model, side):
    out = {}
    for p in model["parameters"]:
        raw = row[p["columns"][side]]
        if raw != "":
            out[p["key"]] = float(raw)
    return out


def main():
    model = load_model()
    real = json.loads(METRICS.read_text(encoding="utf-8"))["sites"]
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))

    print(f"{'pareja':32} {'relieve CSV→real':>18} {'pend.seg CSV→real':>19} {'índice antes→después':>22}  Δ")
    for r in rows:
        m = real.get(r["earth_site_id"])
        if not m or "error" in m:
            print(f"{r['pair_id']:32} sin métricas reales")
            continue
        earth_old = values(r, model, "earth")
        analog = values(r, model, "analog")
        earth_new = dict(earth_old, relief=m["relief_m"], safeSlope=m["safe_slope_pct"])
        before = score(earth_old, analog, model, r["body"])["overall"]
        after = score(earth_new, analog, model, r["body"])["overall"]
        flag = "  (plano)" if m["flat_warning"] else ""
        print(
            f"{r['pair_id']:32} {earth_old['relief']:7.0f}→{m['relief_m']:<8.0f} "
            f"{earth_old['safeSlope']:8.0f}→{m['safe_slope_pct']:<8.0f} "
            f"{before:10.3f}→{after:<10.3f} {after - before:+.3f}{flag}"
        )


if __name__ == "__main__":
    main()
