"""Búsqueda de análogos: compara cada objetivo de la Luna o Marte con todas las celdas de la Tierra.

1. Cada objetivo (pipeline/targets.json) se mide con las mismas fuentes que los sitios.
2. Se arman las variables de la Tierra a la escala de ese cuerpo: celdas de 5 km para la
   Luna y bloques de 4 × 4 celdas (20 km) para Marte.
3. La similitud usa los mismos `span`, grupos y pesos que la app (parameter_model.json),
   solo con los parámetros medidos en ambos lados; `coverage` dice cuántos son.
4. Se guardan los mejores candidatos separados entre sí, y el puesto que ocupan los
   análogos conocidos del CSV para comprobar que el método los encuentra.
"""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .collect import collect_site
from .earth import grid
from .sites import Site, is_candidate_only

MARS_BLOCK = 4          # 4 × 4 celdas de 0.05° ≈ ventana de 20 km
MIN_LAND_PCT = 90       # una celda medio en el mar no es un sitio comparable
EARTH_RADIUS_KM = 6371.0
POOL_PER_CANDIDATE = 400  # celdas revisadas por candidato pedido antes de agrandar el grupo
VALUE_DECIMALS = {"albedo": 3}  # con un decimal el albedo (0–1) perdería casi toda la señal


def _earth_layers(earth: dict, body: str) -> tuple[dict[str, np.ndarray], np.ndarray, np.ndarray]:
    """Variables de la Tierra a la escala del cuerpo, con la latitud y longitud de cada celda."""
    if body == "moon":
        layers = {
            "relief": earth["p98_fine"] - earth["p2_fine"],
            "safeSlope": earth["safe_fine"],
            "craterFree": earth["free_fine"],
        }
        land = earth["land"]
        k = 1
    else:
        k = MARS_BLOCK

        def blocks(a, reducer):
            r, c = a.shape[0] // k, a.shape[1] // k
            with np.errstate(all="ignore"):
                return reducer(a[: r * k, : c * k].reshape(r, k, c, k), axis=(1, 3))

        layers = {
            "relief": blocks(earth["p98_coarse"], np.nanmax) - blocks(earth["p2_coarse"], np.nanmin),
            "safeSlope": blocks(earth["safe_coarse"], np.nanmean),
            "craterFree": blocks(earth["free_coarse"], np.nanmean),
        }
        land = blocks(earth["land"], np.nanmean)
    # Variables globales de MODIS (si ya se calcularon), promediadas a la misma escala
    for name in ("sunlight", "albedo", "ice", "soilStability"):
        if name in earth:
            layers[name] = earth[name] if k == 1 else np.nanmean(
                earth[name][: earth[name].shape[0] // k * k, : earth[name].shape[1] // k * k]
                .reshape(earth[name].shape[0] // k, k, earth[name].shape[1] // k, k), axis=(1, 3))
    rows, cols = np.indices(land.shape)
    lat = 90 - (rows + 0.5) * grid.CELL_DEG * k
    lon = -180 + (cols + 0.5) * grid.CELL_DEG * k
    mask = land >= MIN_LAND_PCT
    return layers, mask, np.stack([lat, lon])


def _score(target: dict, layers: dict, model: dict, body: str) -> tuple[np.ndarray, list[str]]:
    """Índice de similitud de cada celda con el objetivo (0–1) y los parámetros usados."""
    spans = {p["key"]: p["span"] for p in model["parameters"]}
    groups = {p["key"]: p["group"] for p in model["parameters"]}
    weights = model["bodies"][body]["weights"]
    used = [k for k in layers if k in target and k in spans]

    per_group: dict[str, list[np.ndarray]] = {}
    for key in used:
        sim = np.clip(1 - np.abs(layers[key] - target[key]) / spans[key], 0, 1)
        per_group.setdefault(groups[key], []).append(sim)
    total = sum(weights[g] for g in per_group)
    score = sum(weights[g] * np.nanmean(np.stack(sims), axis=0) for g, sims in per_group.items()) / total
    return score, used


def _haversine_km(lat1, lon1, lat2, lon2):
    """Distancia sobre la superficie terrestre en km."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def _top_candidates(score, mask, latlon, layers, used, n: int, min_km: float) -> list[dict]:
    """Los `n` mejores puntos, a más de `min_km` entre sí para no repetir la misma región.

    Se recorren primero las `n × 400` mejores celdas; si todas caen en pocas regiones (los
    mejores análogos de un polo lunar se amontonan en la Antártida), el grupo se agranda
    hasta completar `n` o agotar las celdas válidas.
    """
    flat = np.where(mask & np.isfinite(score), score, -1).ravel()
    pool = n * POOL_PER_CANDIDATE
    while True:
        order = np.argsort(flat)[::-1][:pool]
        picked = _spread_out(flat, order, latlon, n, min_km)
        exhausted = pool >= flat.size or flat[order[-1]] < 0
        if len(picked) == n or exhausted:
            break
        pool *= 8
    lats, lons = latlon[0].ravel()[order], latlon[1].ravel()[order]
    out = []
    for i in picked:
        idx = order[i]
        out.append({
            "lat": round(float(lats[i]), 3), "lon": round(float(lons[i]), 3),
            "score": round(float(flat[idx]), 4),
            "values": {k: round(float(layers[k].ravel()[idx]), VALUE_DECIMALS.get(k, 1)) for k in used},
        })
    return out


def _spread_out(flat, order, latlon, n: int, min_km: float) -> list[int]:
    """Posiciones en `order` de hasta `n` celdas válidas separadas al menos `min_km`."""
    lats, lons = latlon[0].ravel()[order], latlon[1].ravel()[order]
    picked: list[int] = []
    for i, idx in enumerate(order):
        if flat[idx] < 0 or len(picked) == n:
            break
        if picked and np.min(_haversine_km(lats[i], lons[i], lats[picked], lons[picked])) < min_km:
            continue
        picked.append(i)
    return picked


def _rank_of(score, mask, latlon, lat, lon) -> dict | None:
    """Puesto (1 = mejor) de la celda que contiene un punto, entre todas las celdas de tierra."""
    k_deg = abs(latlon[0][0, 0] - latlon[0][1, 0])
    r, c = int((90 - lat) / k_deg), int((lon + 180) / k_deg)
    if not (0 <= r < score.shape[0] and 0 <= c < score.shape[1]) or not np.isfinite(score[r, c]):
        return None
    valid = mask & np.isfinite(score)
    better = int(np.count_nonzero(score[valid] > score[r, c]))
    return {"score": round(float(score[r, c]), 4), "rank": better + 1, "of": int(valid.sum()),
            "topPct": round(100 * (better + 1) / int(valid.sum()), 3)}


def _target_vector(metrics: dict) -> dict:
    """Valores numéricos del objetivo, sin los indicadores internos."""
    return {k: v["value"] for k, v in metrics.items() if not k.startswith("_") and isinstance(v.get("value"), (int, float))}


def _known_analogs(csv_path: Path, known: Path = Path(__file__).parent / "known_analogs.json") -> dict[str, list[dict]]:
    """Puntos de la Tierra conocidos, agrupados por el análogo con que se emparejaron.

    Si existe `known_analogs.json` (parejas elegidas a mano), se usa ese archivo: las
    parejas del CSV ya salen de esta misma búsqueda y validarla con ellas sería circular.
    """
    out: dict[str, list[dict]] = {}
    if known.exists():
        for p in json.loads(known.read_text(encoding="utf-8"))["pairs"]:
            out.setdefault(p["analogId"], []).append({
                "id": p["earthId"], "name": p["earthName"], "lat": p["earthLat"], "lon": p["earthLon"]})
        return out
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if is_candidate_only(row):
                continue
            out.setdefault(row["candidate_id"], []).append({
                "id": row["earth_site_id"], "name": row["earth_site_name"],
                "lat": float(row["earth_latitude"]), "lon": float(row["earth_longitude"])})
    return out


def run(cfg: dict, cache_dir: Path, targets_path: Path, model_path: Path, out_path: Path,
        only: set[str] | None = None, n: int = 25, min_km: float = 150, body: str | None = None) -> Path:
    """Mide los objetivos, puntúa la Tierra para cada uno y escribe los candidatos.

    `only` y `body` limitan los objetivos, para repartir la búsqueda en varias ejecuciones.
    """
    earth = grid.load(Path(cfg["earthGrid"]["file"]))
    model = json.loads(model_path.read_text(encoding="utf-8"))
    known = _known_analogs(Path(cfg["sitesCsv"]))
    targets = json.loads(targets_path.read_text(encoding="utf-8"))["targets"]
    if only:
        targets = [t for t in targets if t["id"] in only]
    if body:
        targets = [t for t in targets if t["body"] == body]

    layers_by_body = {}
    results = []
    for t in targets:
        print(f"- {t['body']}:{t['id']} ({t['name']})")
        site = Site(t["id"], t["body"], t["body"], t["name"], t["lat"], t["lon"])
        measured = collect_site(site, cfg, cache_dir, snow={})
        for name, error in measured.get("errors", {}).items():
            print(f"  ! {name}: {error}")
        vector = _target_vector(measured["metrics"])
        if t["body"] not in layers_by_body:
            layers_by_body[t["body"]] = _earth_layers(earth, t["body"])
        layers, mask, latlon = layers_by_body[t["body"]]
        score, used = _score(vector, layers, model, t["body"])
        requirement = model["bodies"][t["body"]]["requirement"]
        req_value = vector.get(requirement["key"])
        results.append({
            **t,
            "targetValues": vector,
            "requirement": {"key": requirement["key"], "value": req_value, "min": requirement["min"],
                            "pass": None if req_value is None else req_value >= requirement["min"]},
            "parametersUsed": used,
            "candidates": _top_candidates(score, mask, latlon, layers, used, n, min_km),
            "knownAnalogs": [{**a, **(_rank_of(score, mask, latlon, a["lat"], a["lon"]) or {})}
                             for a in known.get(t["id"], [])],
        })
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "earthGrid": {"cellDeg": grid.CELL_DEG, "marsBlockCells": MARS_BLOCK, "minLandPct": MIN_LAND_PCT},
        "targets": results,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out_path
