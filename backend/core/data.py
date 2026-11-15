"""Carga el CSV de parejas y lo expone como candidatos extraterrestres y celdas de la Tierra.

Hoy cada fila del CSV aporta un punto de la Tierra y los datos de su análogo. Cuando haya
celdas reales (p. ej. data/processed/earth_cells), solo cambia `load_earth_cells`.
"""
import csv
from pathlib import Path

from .features import load_model

CSV_PATH = Path(__file__).resolve().parents[2] / "public" / "data" / "planetary_candidates.csv"


def _values(row: dict, model: dict, side: str) -> dict:
    out = {}
    for p in model["parameters"]:
        raw = row.get(p["columns"][side], "")
        if raw != "":
            out[p["key"]] = float(raw)
    return out


def load_all(path: Path = CSV_PATH):
    model = load_model()
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    candidates = {}
    earth_cells = {}
    for r in rows:
        cid = r["candidate_id"]
        if cid not in candidates:
            candidates[cid] = {
                "id": cid,
                "body": r["body"],
                "name": r["analog_site_name"],
                "lat": float(r["analog_latitude"]),
                "lon": float(r["analog_longitude"]),
                "metrics": _values(r, model, "analog"),
                "data_status": r["data_status"],
            }
        eid = r["earth_site_id"]
        earth_cells[eid] = {
            "id": eid,
            "name": r["earth_site_name"],
            "region": r["earth_region"],
            "lat": float(r["earth_latitude"]),
            "lon": float(r["earth_longitude"]),
            "metrics": _values(r, model, "earth"),
            "data_status": r["data_status"],
        }
    return model, candidates, earth_cells
