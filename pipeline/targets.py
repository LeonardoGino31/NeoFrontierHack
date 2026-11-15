"""Arma la lista de objetivos de la búsqueda (pipeline/targets.json).

Une tres orígenes, sin repetir ids:
  1. los análogos de Marte y la Luna del CSV de la app (incluye regiones Artemis III);
  2. objetivos oficiales fijos (pipeline/targets_official.json: Exploration Zones, aterrizajes);
  3. propuestas propias calculadas con datos (moon_proposals.py).
"""

import csv
import json
from pathlib import Path

from .moon_proposals import propose

ARTEMIS_III = {"nobile_rim_1", "malapert_massif", "mons_mouton"}


def _from_csv(csv_path: Path) -> list[dict]:
    """Análogos únicos del CSV como objetivos."""
    out: dict[str, dict] = {}
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            out.setdefault(row["candidate_id"], {
                "id": row["candidate_id"], "body": row["body"], "name": row["analog_site_name"],
                "lat": float(row["analog_latitude"]), "lon": float(row["analog_longitude"]),
                "origin": ("NASA Artemis III: región candidata" if row["candidate_id"] in ARTEMIS_III
                           else "Sitio objetivo de la app (CSV)"),
            })
    return list(out.values())


def build(cfg: dict, cache_dir: Path, model: dict, official_path: Path, out_path: Path) -> Path:
    """Escribe targets.json con todos los objetivos."""
    targets: dict[str, dict] = {}
    official = json.loads(official_path.read_text(encoding="utf-8"))["targets"]
    for t in [*_from_csv(Path(cfg["sitesCsv"])), *official, *propose(cfg, cache_dir, model)]:
        targets.setdefault(t["id"], t)
    out_path.write_text(json.dumps({"targets": list(targets.values())}, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8")
    print(f"  {len(targets)} objetivos")
    return out_path
