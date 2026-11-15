"""Arma la lista de objetivos de la búsqueda (pipeline/targets.json).

Une cuatro orígenes, sin repetir ids:
  1. los análogos de Marte y la Luna del CSV de la app (incluye regiones Artemis III);
  2. los candidatos del backend de selección de sitios (`backend/data/outputs/*.geojson`
     y las filas `candidate_only` del CSV), que aún no tienen contraparte en la Tierra;
  3. objetivos oficiales fijos (pipeline/targets_official.json: Exploration Zones, aterrizajes);
  4. propuestas propias calculadas con datos (moon_proposals.py).
"""

import csv
import json
from pathlib import Path

from .moon_proposals import propose
from .sites import is_candidate_only

ARTEMIS_III = {"nobile_rim_1", "malapert_massif", "mons_mouton"}
BACKEND_ORIGIN = "Candidato del backend de selección de sitios"
BODY_NAMES = {"moon": "lunar", "mars": "marciano"}


def _backend_info(props: dict) -> dict:
    """Resumen del veredicto del backend, para mostrarlo junto a los análogos encontrados."""
    return {"status": props.get("candidate_status"), "eligible": props.get("eligible"),
            "overallScore": props.get("overall_score"), "filterStatus": props.get("filter_status")}


def _from_csv(csv_path: Path) -> list[dict]:
    """Análogos únicos del CSV como objetivos, incluidos los candidatos del backend."""
    out: dict[str, dict] = {}
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            target = {
                "id": row["candidate_id"], "body": row["body"], "name": row["analog_site_name"],
                "lat": float(row["analog_latitude"]), "lon": float(row["analog_longitude"]),
                "origin": ("NASA Artemis III: región candidata" if row["candidate_id"] in ARTEMIS_III
                           else "Sitio objetivo de la app (CSV)"),
            }
            if is_candidate_only(row):
                score = row.get("candidate_overall_score")
                target |= {"origin": BACKEND_ORIGIN, "backend": _backend_info({
                    "candidate_status": row.get("candidate_status"),
                    "eligible": row.get("candidate_eligible") == "true",
                    "overall_score": float(score) if score else None,
                    "filter_status": row.get("candidate_filter_status")})}
            out.setdefault(row["candidate_id"], target)
    return list(out.values())


def _from_backend(rules: dict) -> list[dict]:
    """Candidatos de las salidas GeoJSON del backend, los mejores `maxPerBody` por cuerpo.

    El CSV solo trae las alternativas; los candidatos principales viven en los GeoJSON.
    Si el backend no se ha ejecutado (o no está en esta rama), no aporta objetivos.
    """
    by_body: dict[str, list[dict]] = {}
    for name in rules["files"]:
        path = Path(name)
        if not path.exists():
            continue
        for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
            props = feature["properties"]
            lon, lat = feature["geometry"]["coordinates"][:2]
            body = props["body"]
            by_body.setdefault(body, []).append({
                "id": props["candidate_id"], "body": body,
                "name": f"Candidato {BODY_NAMES.get(body, body)} · {props['candidate_id']}",
                "lat": round(lat, 4), "lon": round(lon, 4),
                "origin": BACKEND_ORIGIN, "backend": _backend_info(props),
            })
    out = []
    for targets in by_body.values():
        # Primero los que pasan los filtros del backend; dentro de ellos, el mejor puntaje
        targets.sort(key=lambda t: (not t["backend"]["eligible"], -(t["backend"]["overallScore"] or 0)))
        out += targets[: rules["maxPerBody"]]
    return out


def build(cfg: dict, cache_dir: Path, model: dict, official_path: Path, out_path: Path) -> Path:
    """Escribe targets.json con todos los objetivos."""
    targets: dict[str, dict] = {}
    official = json.loads(official_path.read_text(encoding="utf-8"))["targets"]
    backend = _from_backend(cfg["backendCandidates"])
    for t in [*_from_csv(Path(cfg["sitesCsv"])), *backend, *official, *propose(cfg, cache_dir, model)]:
        targets.setdefault(t["id"], t)
    out_path.write_text(json.dumps({"targets": list(targets.values())}, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8")
    from_backend = sum(t.get("origin") == BACKEND_ORIGIN for t in targets.values())
    print(f"  {len(targets)} objetivos ({from_backend} del backend)")
    return out_path
