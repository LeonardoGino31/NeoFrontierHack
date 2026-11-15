"""Convierte los candidatos del backend en parejas Tierra–análogo con su mejor análogo terrestre.

Para cada fila `candidate_only` del CSV (un punto de la Luna o Marte elegido por el backend):
  1. toma de `earth_candidates.json` el mejor punto de la Tierra que esté a más de
     `min_km` de los ya elegidos (si no, varios candidatos polares caerían en la misma celda);
  2. mide el punto terrestre con las mismas fuentes que la búsqueda; el lado del análogo
     se copia de la fila del candidato (candidates.py ya lo midió), así ambas coinciden;
  3. agrega una fila `pair` con esos valores y la comparación litológica. La fila del
     candidato se conserva intacta.

Las parejas elegidas a mano que había antes se guardan en `known_analogs.json`: dejan de
mostrarse en el globo, pero siguen sirviendo para validar la búsqueda (puesto que obtienen).
"""

import csv
import json
import math
import time
from pathlib import Path

import requests

from . import geology
from .collect import collect_site
from .output import write_values
from .sites import Site, is_candidate_only

GEOCODER = "https://nominatim.openstreetmap.org/reverse"
# Nominatim pide un User-Agent que identifique la aplicación y máximo una petición por segundo
GEOCODER_HEADERS = {"User-Agent": "NeoFrontierHack-pipeline/1.0"}
PAIR_STATUS = "medido_parcial"
EARTH_RADIUS_KM = 6371.0


def save_known_analogs(rows: list[dict], path: Path) -> None:
    """Guarda las parejas elegidas a mano (solo la primera vez: después ya no están en el CSV)."""
    if path.exists():
        return
    known = [{
        "earthId": r["earth_site_id"], "earthName": r["earth_site_name"],
        "earthLat": float(r["earth_latitude"]), "earthLon": float(r["earth_longitude"]),
        "analogId": r["candidate_id"], "body": r["body"], "analogName": r["analog_site_name"],
        "analogLat": float(r["analog_latitude"]), "analogLon": float(r["analog_longitude"]),
    } for r in rows if not is_candidate_only(r)]
    path.write_text(json.dumps({"pairs": known}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia sobre la superficie terrestre en km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _pick(target: dict, chosen: list[tuple[float, float]], min_km: float) -> tuple[dict, int]:
    """Mejor candidato terrestre lejos de los ya elegidos, y su puesto en la búsqueda."""
    for rank, c in enumerate(target["candidates"], start=1):
        if all(_haversine_km(c["lat"], c["lon"], la, lo) >= min_km for la, lo in chosen):
            return c, rank
    return target["candidates"][0], 1


def place_name(lat: float, lon: float, cache_dir: Path) -> tuple[str, str]:
    """Nombre corto del lugar y región (estado, país) por geocodificación inversa, con caché."""
    cache = cache_dir / "geocode.json"
    names = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    key = f"{lat:.3f},{lon:.3f}"
    if key not in names:
        time.sleep(1.1)
        try:
            response = requests.get(GEOCODER, headers=GEOCODER_HEADERS, timeout=30, params={
                "lat": lat, "lon": lon, "zoom": 8, "format": "jsonv2", "accept-language": "es"})
            address = response.json().get("address", {}) if response.ok else {}
        except requests.RequestException:
            address = {}
        names[key] = address
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    address = {k: _latin(v) for k, v in names[key].items() if isinstance(v, str)}
    country = address.get("country") or ("Antártida" if lat < -60 else "")
    state = address.get("state") or address.get("region") or address.get("province") or ""
    place = (address.get("county") or address.get("city") or address.get("town")
             or address.get("municipality") or state or country)
    name = place or f"{abs(lat):.2f}° {'S' if lat < 0 else 'N'}, {abs(lon):.2f}° {'O' if lon < 0 else 'E'}"
    region = ", ".join(x for x in (state if state != place else "", country) if x) or "Sin región"
    return name, region


def _latin(text: str) -> str:
    """Parte en alfabeto latino de un nombre ("Halfa - حلفا" -> "Halfa"); vacío si no la hay.

    OpenStreetMap a veces da el nombre local aunque se pida en español.
    """
    parts = [p.strip() for p in text.split(" - ")]
    latin = [p for p in parts if p and all(ord(ch) < 0x0370 for ch in p)]
    return latin[0] if latin else ""


def _value(metrics: dict, key: str):
    """Valor de una métrica medida, o None si no se pudo medir."""
    record = metrics.get(key)
    return None if record is None else record["value"]


def _pair_row(fields: list[str], cand: dict, earth: dict, model: dict, earth_info: dict,
              earth_class: str | None) -> dict:
    """Fila `pair` del CSV: el análogo copiado del candidato y el punto terrestre medido.

    Si un factor no se midió en un lado, la app exige un número: se pone el centro del rango
    del simulador y la app lo marca como demo (no coincide con site_values.json).
    """
    body = cand["body"]
    row = {k: "" for k in fields}
    # El análogo se copia tal cual del candidato: la app exige que coincida entre filas
    for k in ("candidate_id", "body", "analog_site_name", "analog_latitude", "analog_longitude",
              "footprint_km", "analog_kind", "analog_description", "analog_polar",
              "geology_analog", "geology_unit_analog"):
        row[k] = cand.get(k, "")
    row |= {"record_type": "pair", "data_status": PAIR_STATUS,
            "pair_id": f"par-{cand['candidate_id']}", **earth_info["columns"]}

    em = earth["metrics"]
    for p in model["parameters"]:
        columns = [(p["columns"], p["key"], p["ranges"])]
        if "confidenceColumns" in p:
            columns.append((p["confidenceColumns"], f"{p['key']}Confidence", None))
        for cols, key, ranges in columns:
            value = _value(em, key)
            if value is None:
                value = round(sum(ranges["earth"]) / 2, p["decimals"]) if ranges else 0
            row[cols["earth"]] = str(value)
            analog = cand.get(cols["analog"], "")
            if analog == "":
                analog = str(round(sum(ranges[body]) / 2, p["decimals"]) if ranges else 0)
            row[cols["analog"]] = analog
    req = model["bodies"][body]["requirement"]
    row[req["column"]] = cand.get(req["column"], "")
    target_class = cand.get("geology_analog")
    row["geology_earth"] = earth_class or ""
    if target_class and earth_class:
        lut = geology.affinity_lut(target_class)
        row["geology_similarity"] = str(round(float(lut[geology.class_code(earth_class)]), 2))
    return row


def _sentence(text: str) -> str:
    """Primera letra en mayúscula sin tocar el resto (`capitalize` pasaría "GLiM" a "glim")."""
    return text[:1].upper() + text[1:]


def _use_search_values(earth: dict, pick: dict, window_km: float) -> None:
    """Pone en el punto terrestre los valores de la celda con que la búsqueda lo eligió.

    `collect_site` mide otra ventana (DEM de 30 m, o varias celdas de 0.05° que cerca de los
    polos cubren hielo y roca a la vez) y podía dar otro número: la pareja debe mostrar los
    valores que produjeron la similitud.
    """
    for key, value in pick["values"].items():
        record = earth["metrics"].get(key)
        if record is None or value is None:
            continue
        record["value"] = value
        record["note"] = f"celda de la búsqueda global ({window_km:g} km)" + (
            f"; {record['note']}" if record.get("note") else "")


def _earth_text(cand: dict, pick: dict, rank: int, earth: dict, window_km: float,
                earth_class: str | None) -> tuple[str, str]:
    """Descripción y límites del punto terrestre, a partir de lo que se midió."""
    m = earth["metrics"]
    parts = [f"desnivel {m['relief']['value']} m" if "relief" in m else "",
             f"pendiente segura {m['safeSlope']['value']} %" if "safeSlope" in m else "",
             f"luz solar {m['sunlight']['value']} %" if "sunlight" in m else "",
             f"hielo {m['ice']['value']:.0f} pts" if "ice" in m else ""]
    if earth_class:
        parts.append(f"roca: {geology.class_label(earth_class).lower()} (GLiM)")
    description = (f"La celda de {window_km:g} km más parecida a {cand['analog_site_name']} en toda la Tierra "
                   f"(similitud {100 * pick['score']:.1f} %, puesto {rank} de la búsqueda global). "
                   + _sentence(", ".join(p for p in parts if p)) + ".")
    target_class = cand.get("geology_analog")
    if target_class and earth_class and target_class != earth_class:
        rock = (f"La roca no es la misma: {geology.class_label(target_class).lower()} en "
                f"{'la Luna' if cand['body'] == 'moon' else 'Marte'} frente a "
                f"{geology.class_label(earth_class).lower()} aquí. ")
    elif target_class and earth_class:
        rock = f"Misma clase de roca ({geology.class_label(earth_class).lower()}), según mapas de escala regional. "
    else:
        rock = "Sin dato de geología para comparar la roca. "
    limits = (rock + "La comparación usa terreno, luz, albedo, suelo, hielo y litología a escala regional "
              "(GLiM 0.5°); no reproduce la gravedad, el vacío o la atmósfera, la radiación ni la "
              "mineralogía de detalle.")
    return description, limits


def build(cfg: dict, cache_dir: Path, csv_path: Path, candidates_path: Path, values_path: Path,
          known_path: Path, model: dict, min_km: float = 150) -> int:
    """Reescribe el CSV con una pareja por candidato del backend y actualiza site_values.json."""
    with csv_path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    save_known_analogs(rows, known_path)
    candidates = [r for r in rows if is_candidate_only(r)]
    results = {t["id"]: t for t in json.loads(candidates_path.read_text(encoding="utf-8"))["targets"]}
    # Las mediciones de los candidatos (candidates.py) se conservan: la app comprueba contra ellas
    previous = json.loads(values_path.read_text(encoding="utf-8"))["sites"] if values_path.exists() else {}
    values = {k: v for k, v in previous.items() if not k.startswith("earth:")}

    chosen: list[tuple[float, float]] = []
    pairs = []
    for cand in candidates:
        cid, body = cand["candidate_id"], cand["body"]
        target = results.get(cid)
        if not target or not target["candidates"]:
            print(f"  ! {cid}: sin resultados de búsqueda; se omite")
            continue
        pick, rank = _pick(target, chosen, min_km)
        chosen.append((pick["lat"], pick["lon"]))
        name, region = place_name(pick["lat"], pick["lon"], cache_dir)
        earth_id = f"tierra-{cid}"
        print(f"- {cid} -> {name} ({region}), puesto {rank}, similitud {100 * pick['score']:.1f} %")

        earth = collect_site(Site(earth_id, "earth", body, name, pick["lat"], pick["lon"]), cfg, cache_dir, snow={})
        _use_search_values(earth, pick, cfg["windows"][body]["sizeKm"])
        earth_class = pick["values"].get("lithology")
        description, limits = _earth_text(cand, pick, rank, earth, cfg["windows"][body]["sizeKm"], earth_class)
        earth_info = {"id": earth_id, "columns": {
            "earth_site_id": earth_id, "earth_site_name": name, "earth_region": region,
            "earth_latitude": str(pick["lat"]), "earth_longitude": str(pick["lon"]),
            "earth_kind": "Análogo encontrado por la búsqueda", "earth_description": description,
            "earth_limits": limits}}
        pairs.append(_pair_row(fields, cand, earth, model, earth_info, earth_class))
        values[f"earth:{earth_id}"] = earth

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(pairs + candidates)
    write_values(values_path, values, cfg)
    return len(pairs)
