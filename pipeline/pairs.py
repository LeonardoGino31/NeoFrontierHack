"""Convierte los candidatos del backend en parejas Tierra–análogo con su mejor análogo terrestre.

Para cada fila `candidate_only` del CSV (un punto de la Luna o Marte elegido por el backend):
  1. toma de `earth_candidates.json` el mejor punto de la Tierra que esté a más de
     `min_km` de los ya elegidos (si no, varios candidatos polares caerían en la misma celda);
  2. mide los dos lados con las mismas fuentes que la búsqueda;
  3. agrega una fila `pair` con esos valores. La fila del candidato se conserva intacta.

Las parejas elegidas a mano que había antes se guardan en `known_analogs.json`: dejan de
mostrarse en el globo, pero siguen sirviendo para validar la búsqueda (puesto que obtienen).
"""

import csv
import json
import math
import time
from pathlib import Path

import requests

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


def _fallback(candidate_row: dict, column: str, key: str, metrics: dict) -> float | None:
    """Estimación del backend para una métrica que el pipeline no mide en ese punto.

    Se registra como `estimated` con su método, para que la app no la presente como medición.
    """
    raw = candidate_row.get(column, "")
    if raw == "":
        return None
    meta = json.loads(candidate_row.get("candidate_factor_metadata_json") or "{}").get(key, {})
    metrics[key] = {"value": float(raw), "unit": meta.get("unit", ""), "status": "estimated",
                    "note": meta.get("method", "estimación del backend"),
                    "source": {"dataset": "Estimación del backend (backend/scripts/enrich_candidate_factors.py)"}}
    return float(raw)


def _pair_row(fields: list[str], cand: dict, earth: dict, analog: dict, model: dict,
              earth_info: dict) -> dict:
    """Fila `pair` del CSV: datos descriptivos de ambos sitios y los valores medidos."""
    body = cand["body"]
    row = {k: "" for k in fields}
    # El análogo se copia tal cual del candidato: la app exige que coincida entre filas
    for k in ("candidate_id", "body", "analog_site_name", "analog_latitude", "analog_longitude",
              "footprint_km", "analog_kind", "analog_description", "analog_polar"):
        row[k] = cand[k]
    row |= {"record_type": "pair", "data_status": PAIR_STATUS,
            "pair_id": f"par-{cand['candidate_id']}", **earth_info["columns"]}

    em, am = earth["metrics"], analog["metrics"]
    for p in model["parameters"]:
        for side, metrics, key in (("earth", em, p["key"]), ("analog", am, p["key"])):
            value = _value(metrics, key)
            if value is None and side == "analog":
                value = _fallback(cand, p["columns"][side], key, metrics)
            lo, hi = p["ranges"]["earth" if side == "earth" else body]
            row[p["columns"][side]] = str(value if value is not None else round((lo + hi) / 2, p["decimals"]))
        if "confidenceColumns" in p:
            for side, metrics in (("earth", em), ("analog", am)):
                value = _value(metrics, f"{p['key']}Confidence")
                if value is None and side == "analog":
                    value = _fallback(cand, p["confidenceColumns"][side], f"{p['key']}Confidence", metrics)
                row[p["confidenceColumns"][side]] = str(value if value is not None else 0)
    req = model["bodies"][body]["requirement"]
    value = _value(am, req["key"])
    row[req["column"]] = str(value if value is not None else cand.get(req["column"], ""))
    return row


def _earth_text(cand: dict, pick: dict, rank: int, earth: dict, window_km: float) -> tuple[str, str]:
    """Descripción y límites del punto terrestre, a partir de lo que se midió."""
    m = earth["metrics"]
    parts = [f"desnivel {m['relief']['value']} m" if "relief" in m else "",
             f"pendiente segura {m['safeSlope']['value']} %" if "safeSlope" in m else "",
             f"luz solar {m['sunlight']['value']} %" if "sunlight" in m else "",
             f"hielo {m['ice']['value']:.0f} pts" if "ice" in m else ""]
    description = (f"La celda de {window_km:g} km más parecida a {cand['analog_site_name']} en toda la Tierra "
                   f"(similitud {100 * pick['score']:.1f} %, puesto {rank} de la búsqueda global). "
                   + ", ".join(p for p in parts if p).capitalize() + ".")
    limits = ("La búsqueda compara solo los parámetros medidos (terreno, luz, albedo, suelo y hielo); "
              "la gravedad, la atmósfera, la radiación y la geología no entran en la comparación.")
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

    chosen: list[tuple[float, float]] = []
    pairs, values = [], {}
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
        analog = collect_site(Site(cid, body, body, cand["analog_site_name"],
                                   float(cand["analog_latitude"]), float(cand["analog_longitude"])),
                              cfg, cache_dir, snow={})
        description, limits = _earth_text(cand, pick, rank, earth, cfg["windows"][body]["sizeKm"])
        earth_info = {"id": earth_id, "columns": {
            "earth_site_id": earth_id, "earth_site_name": name, "earth_region": region,
            "earth_latitude": str(pick["lat"]), "earth_longitude": str(pick["lon"]),
            "earth_kind": "Análogo encontrado por la búsqueda", "earth_description": description,
            "earth_limits": limits}}
        pairs.append(_pair_row(fields, cand, earth, analog, model, earth_info))
        values[f"earth:{earth_id}"] = earth
        values[f"{body}:{cid}"] = analog

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(pairs + candidates)
    write_values(values_path, values, cfg)
    return len(pairs)
