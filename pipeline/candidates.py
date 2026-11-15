"""Filas `candidate_only` del CSV a partir de las salidas del backend (`backend/data/outputs/`).

Antes el CSV traía una copia manual de las *alternativas* del backend, con tres problemas:

- faltaban los candidatos que el backend sí eligió (`*_candidates.geojson`);
- las alternativas `passed_but_too_close` están, por definición, a menos de la separación
  mínima de un candidato elegido: en el globo eran el mismo sitio repetido;
- los valores de la fila del candidato (estimaciones del backend) no coincidían con los del
  mismo punto en su pareja (mediciones del pipeline).

Aquí se toman los candidatos elegidos y los `near_miss`, se descartan los que caen a menos de
`minSeparationKm` de uno mejor y cada punto se mide una sola vez con las mismas fuentes que
la búsqueda. La pareja (pairs.py) copia estos valores tal cual, así que ambas filas coinciden.
El veredicto del backend (puntaje, filtros, grupos) se conserva como estaba.
"""

import csv
import json
import math
from pathlib import Path

from . import geology, names
from .collect import collect_site
from .output import write_values
from .sites import CANDIDATE_ONLY, Site

STATUS_TEXT = {
    "selected": "Candidato elegido por el backend",
    "near_miss": "Casi cumple los filtros del backend",
    "ice_unassessed": "Sin evaluación de hielo en el backend",
}
CONFIDENCE = {"measured": "media", "derived": "media", "estimated": "baja"}
NEW_COLUMNS = ["geology_earth", "geology_analog", "geology_unit_analog", "geology_similarity"]


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float, radius_km: float) -> float:
    """Distancia sobre la superficie de un cuerpo esférico."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * radius_km * math.asin(math.sqrt(min(1.0, a)))


def _features(files: list[str]) -> list[dict]:
    """Puntos de todas las salidas GeoJSON del backend que existan."""
    out = []
    for name in files:
        path = Path(name)
        if path.exists():
            out += json.loads(path.read_text(encoding="utf-8"))["features"]
    return out


def pick(features: list[dict], rules: dict, radii: dict) -> list[dict]:
    """Candidatos a mostrar por cuerpo: por estado y puntaje, separados entre sí.

    Los estados van en el orden de `rules["statuses"]` (primero los elegidos). Un punto a
    menos de `minSeparationKm` de otro ya tomado se descarta: es el mismo sitio.
    """
    order = {s: i for i, s in enumerate(rules["statuses"])}
    chosen: list[dict] = []
    for body in ("moon", "mars"):
        pool = [f for f in features if f["properties"]["body"] == body
                and f["properties"]["candidate_status"] in order]
        pool.sort(key=lambda f: (order[f["properties"]["candidate_status"]],
                                 -(f["properties"].get("overall_score") or 0)))
        taken: list[dict] = []
        for f in pool:
            lon, lat = f["geometry"]["coordinates"][:2]
            if any(_distance_km(lat, lon, t["geometry"]["coordinates"][1], t["geometry"]["coordinates"][0],
                                radii[body]) < rules["minSeparationKm"][body] for t in taken):
                continue
            taken.append(f)
            if len(taken) == rules["maxPerBody"][body]:
                break
        chosen += taken
    return chosen


def _factor_metadata(key: str, record: dict | None, backend_value) -> dict | None:
    """Procedencia de un factor, en el formato que ya muestra la app (`candidate_factor_metadata_json`)."""
    if record is None:
        return None
    source = record.get("source", {})
    meta = {
        "value": record["value"], "unit": record.get("unit", ""),
        "kind": f"pipeline_{record.get('status', 'derived')}",
        "confidence": CONFIDENCE.get(record.get("status"), "baja"),
        "method": record.get("note") or "Medido por el pipeline con la misma fuente que la búsqueda de análogos.",
        "source": source.get("dataset", ""),
        "limitation": "Valor de la ventana del pipeline (5 km en la Luna, 20 km en Marte); "
                      "el backend analiza un entorno de 30 km y puede dar otro número.",
    }
    if source.get("url"):
        meta["source_url"] = source["url"]
    if backend_value is not None:
        meta["backend_value"] = backend_value
    return meta


def _row(fields: list[str], feature: dict, measured: dict, model: dict, place: dict) -> dict:
    """Fila `candidate_only`: datos del sitio, factores medidos y veredicto del backend."""
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"][:2]
    body, metrics = props["body"], measured["metrics"]
    backend_metrics = props.get("metrics") or {}
    lith = metrics.get("lithology")
    row = {k: "" for k in fields}
    row |= {
        "candidate_id": props["candidate_id"], "body": body, "record_type": CANDIDATE_ONLY,
        "analog_site_name": place["name"], "analog_latitude": f"{lat:.5f}", "analog_longitude": f"{lon:.5f}",
        "footprint_km": str(props.get("footprint_km_at_equator", 30)),
        "analog_kind": STATUS_TEXT.get(props["candidate_status"], props["candidate_status"]),
        "analog_description": _description(props, place, lith),
        "analog_polar": "true" if abs(lat) >= 75 else "false",
        "data_status": props["candidate_status"],
        "candidate_status": props["candidate_status"],
        "candidate_eligible": "true" if props.get("eligible") else "false",
        "candidate_filter_status": props.get("filter_status") or "not_evaluated",
        "candidate_overall_score": str(props.get("overall_score") or 0),
        "candidate_score_is_partial": "true" if props.get("score_is_partial") else "false",
        "candidate_scoring_coverage_percent": _str(props.get("scoring_coverage_percent")),
        "candidate_parameter_data_coverage_percent": _str(props.get("parameter_data_coverage_percent")),
        "candidate_hard_filter_coverage_percent": _str(props.get("hard_filter_coverage_percent")),
        "candidate_group_scores_json": json.dumps(props.get("group_scores") or {}, ensure_ascii=False),
        "candidate_parameter_scores_json": json.dumps(props.get("parameter_scores") or {}, ensure_ascii=False),
        "candidate_hard_filters_json": json.dumps(props.get("hard_filters") or {}, ensure_ascii=False),
        "candidate_selection_detail_json": json.dumps(props.get("selection_detail") or {}, ensure_ascii=False),
        "geology_analog": lith["value"] if lith else "",
        "geology_unit_analog": lith.get("mapUnit", "") if lith else "",
    }
    metadata = {}
    for p in model["parameters"]:
        keys = [(p["key"], p["columns"]["analog"])]
        if "confidenceColumns" in p:
            keys.append((f"{p['key']}Confidence", p["confidenceColumns"]["analog"]))
        for key, column in keys:
            record = metrics.get(key)
            row[column] = _str(record["value"]) if record else ""
            meta = _factor_metadata(key, record, backend_metrics.get(key))
            if meta and not key.endswith("Confidence"):
                metadata[key] = meta
    req = model["bodies"][body]["requirement"]
    record = metrics.get(req["key"])
    row[req["column"]] = _str(record["value"]) if record else ""
    if lith:
        metadata["lithology"] = _factor_metadata("lithology", lith, None)
    row["candidate_factor_metadata_json"] = json.dumps(metadata, ensure_ascii=False)
    return row


def _description(props: dict, place: dict, lith: dict | None) -> str:
    """Texto corto del sitio: dónde está, su geología y qué dijo el backend."""
    parts = [place["context"]]
    if lith:
        parts.append(f"Geología: {geology.class_label(lith['value']).lower()} (unidad {lith.get('mapUnit')})")
    score = props.get("overall_score")
    if score is not None:
        parts.append(f"Puntaje del backend {score:.1f}/100"
                     + (" con datos parciales" if props.get("score_is_partial") else ""))
    return ". ".join(parts) + "."


def _disambiguate(places: list[dict], features: list[dict]) -> None:
    """Agrega las coordenadas a los nombres repetidos: en el globo deben distinguirse."""
    counts: dict[str, int] = {}
    for place in places:
        counts[place["name"]] = counts.get(place["name"], 0) + 1
    for place, feature in zip(places, features):
        if counts[place["name"]] > 1:
            lon, lat = feature["geometry"]["coordinates"][:2]
            place["name"] += f" ({abs(lat):.1f}° {'S' if lat < 0 else 'N'}, {abs(lon):.1f}° {'O' if lon < 0 else 'E'})"


def _str(value) -> str:
    """Número para el CSV; vacío si no hay dato."""
    return "" if value is None else str(value)


def build(cfg: dict, cache_dir: Path, csv_path: Path, values_path: Path, model: dict) -> int:
    """Reescribe el CSV solo con los candidatos (las parejas se regeneran con `pairs`)."""
    with csv_path.open(encoding="utf-8", newline="") as f:
        fields = list(csv.DictReader(f).fieldnames)
    fields += [c for c in NEW_COLUMNS if c not in fields]
    rules = cfg["candidateRows"]
    radii = {b: cfg["bodies"][b]["radiusKm"] for b in ("moon", "mars")}
    chosen = pick(_features(cfg["backendCandidates"]["files"]), rules, radii)

    places = [names.describe(f["properties"]["body"], f["geometry"]["coordinates"][1],
                             f["geometry"]["coordinates"][0], cfg, cache_dir) for f in chosen]
    _disambiguate(places, chosen)

    rows, values = [], {}
    for feature, place in zip(chosen, places):
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"][:2]
        body, cid = props["body"], props["candidate_id"]
        print(f"- {cid} ({props['candidate_status']}) -> {place['name']}")
        measured = collect_site(Site(cid, body, body, place["name"], lat, lon), cfg, cache_dir, snow={})
        for step, error in measured.get("errors", {}).items():
            print(f"  ! {step}: {error}")
        rows.append(_row(fields, feature, measured, model, place))
        values[f"{body}:{cid}"] = measured

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    write_values(values_path, values, cfg)
    return len(rows)
