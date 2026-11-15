"""Escritura de site_values.json y su volcado al CSV que lee la app."""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from .sites import is_candidate_only

# Métrica del pipeline → prefijo de columna del CSV (se completa con _earth o _analog)
CSV_COLUMNS = {
    "sunlight": "sunlight",
    "relief": "relief",
    "safeSlope": "safe_slope",
    "craterFree": "crater_free",
    "ice": "ice",
    "iceConfidence": "ice_confidence",
}
# Requisitos: solo existen del lado del análogo
ANALOG_ONLY_COLUMNS = {"earthView": "earth_view_analog", "descent": "descent_density_analog"}
PARTIAL_STATUS = "medido_parcial"


def write_values(path: Path, sites: dict, cfg: dict) -> None:
    """Guarda las métricas con la configuración usada, para poder reproducirlas."""
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "windows": cfg["windows"],
        "thresholds": cfg["thresholds"],
        "sites": sites,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply_to_csv(values_path: Path, csv_path: Path) -> int:
    """Copia al CSV los valores medidos; las columnas sin dato real conservan el valor demo.

    Devuelve cuántas celdas cambiaron.
    """
    sites = json.loads(values_path.read_text(encoding="utf-8"))["sites"]
    with csv_path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)

    changed = 0
    for row in rows:
        if is_candidate_only(row):
            continue  # valores del backend: mezclar fuentes en una fila ocultaría su procedencia
        sides = {"earth": sites.get(f"earth:{row['earth_site_id']}"),
                 "analog": sites.get(f"{row['body']}:{row['candidate_id']}")}
        touched = False
        for side, site in sides.items():
            for metric, record in (site or {}).get("metrics", {}).items():
                column = (f"{CSV_COLUMNS[metric]}_{side}" if metric in CSV_COLUMNS
                          else ANALOG_ONLY_COLUMNS.get(metric) if side == "analog" else None)
                if column and column in row and row[column] != str(record["value"]):
                    row[column] = str(record["value"])
                    changed += 1
                    touched = True
        if touched:
            row["data_status"] = PARTIAL_STATUS

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return changed
