"""Búsqueda de análogos: compara cada objetivo de la Luna o Marte con todas las celdas de la Tierra.

1. Cada objetivo (pipeline/targets.json) se mide con las mismas fuentes que los sitios.
2. Se arman las variables de la Tierra a la escala de ese cuerpo: celdas de 5 km para la
   Luna y bloques de 4 × 4 celdas (20 km) para Marte.
3. La similitud usa los mismos `span`, grupos y pesos que la app (parameter_model.json),
   solo con los parámetros medidos en ambos lados, más la litología (geology.py) con el
   peso de `parameter_model.json → geology`. Un cuerpo puede excluir parámetros que no
   distinguen sitios (`searchExclude`: la luz solar de Marte es ~50 % en casi todo el planeta).
4. Se guardan los mejores candidatos separados entre sí, y el puesto que ocupan los
   análogos conocidos para comprobar el método, con el método anterior (solo parámetros
   físicos) y con el actual: es la validación que se publica en validation.json.
"""

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import geology
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
    if "lithology" in earth:
        # Categoría: no se promedia. GLiM es de 0.5°, así que cualquier celda del bloque vale
        lith = earth["lithology"]
        layers["lithology"] = lith if k == 1 else lith[: lith.shape[0] // k * k, : lith.shape[1] // k * k][k // 2::k, k // 2::k]
    rows, cols = np.indices(land.shape)
    lat = 90 - (rows + 0.5) * grid.CELL_DEG * k
    lon = -180 + (cols + 0.5) * grid.CELL_DEG * k
    mask = land >= MIN_LAND_PCT
    if "lithology" in layers:
        # Los lagos están en el DEM como tierra, pero un lago no es un sitio de entrenamiento
        mask &= layers["lithology"] != geology.WATER
    return layers, mask, np.stack([lat, lon])


def _group_sims(target: dict, layers: dict, model: dict, body: str, use_geology: bool = True,
                exclude: tuple[str, ...] | None = None) -> tuple[dict[str, np.ndarray], dict, list[str]]:
    """Similitud de cada grupo (0–1) por celda, los pesos del cuerpo y los parámetros usados.

    `exclude` quita parámetros (por defecto, los `searchExclude` del cuerpo). Con
    `use_geology=False` y `exclude=()` se reproduce el método anterior, para la validación.
    """
    spans = {p["key"]: p["span"] for p in model["parameters"]}
    groups = {p["key"]: p["group"] for p in model["parameters"]}
    weights = dict(model["bodies"][body]["weights"])
    if exclude is None:
        exclude = tuple(model["bodies"][body].get("searchExclude", []))
    used = [k for k in layers if k in target and k in spans and k not in exclude]

    per_group: dict[str, list[np.ndarray]] = {}
    for key in used:
        sim = np.clip(1 - np.abs(layers[key] - target[key]) / spans[key], 0, 1)
        per_group.setdefault(groups[key], []).append(sim)
    with np.errstate(all="ignore"):
        sims = {g: np.nanmean(np.stack(arrs), axis=0) for g, arrs in per_group.items()}
    geo = model.get("geology")
    target_class = target.get(geo["key"]) if geo else None
    if use_geology and target_class and "lithology" in layers:
        sims["geology"] = geology.similarity(layers["lithology"], target_class)
        weights["geology"] = geo["weights"][body]
        used = [*used, geo["key"]]
    return sims, weights, used


def _score(target: dict, layers: dict, model: dict, body: str, use_geology: bool = True,
           exclude: tuple[str, ...] | None = None) -> tuple[np.ndarray, list[str]]:
    """Índice de similitud de cada celda con el objetivo (0–1) y los parámetros usados.

    Donde GLiM no tiene dato (islas y costas que caen en una celda de mar de 0.5°, como
    Lanzarote) la litología vale la afinidad media de la Tierra: un valor neutro. Dejarla
    fuera daría ventaja a esas celdas; ponerla en cero las sacaría de la búsqueda.
    """
    sims, weights, used = _group_sims(target, layers, model, body, use_geology, exclude)
    if "geology" in sims:
        geo = sims.pop("geology")
        if np.isfinite(geo).any():
            sims["geology"] = np.where(np.isfinite(geo), geo, np.nanmean(geo))
    total = sum(weights[g] for g in sims)
    return sum(weights[g] * sim for g, sim in sims.items()) / total, used


def _scores_by_group(target: dict, layers: dict, model: dict, body: str) -> dict[str, np.ndarray]:
    """Una similitud por dimensión (terreno, luz, hielo, geología): en qué se parece cada sitio."""
    sims, _, _ = _group_sims(target, layers, model, body)
    return {f"group:{g}": sim for g, sim in sims.items()}


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
            "values": {k: _cell_value(layers, k, idx) for k in used},
        })
    return out


def _cell_value(layers: dict, key: str, idx: int):
    """Valor de una capa en una celda; la litología se devuelve como clave de clase."""
    if key == "lithology":
        code = layers["lithology"].ravel()[idx]
        return geology.class_keys()[int(code) - 1] if np.isfinite(code) and code > 0 else None
    value = float(layers[key].ravel()[idx])
    # NaN no es JSON válido: el navegador no podría leer earth_candidates.json
    return round(value, VALUE_DECIMALS.get(key, 1)) if math.isfinite(value) else None


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


def _cell_index(latlon, lat: float, lon: float) -> int:
    """Índice plano de la celda que contiene un punto."""
    k_deg = abs(latlon[0][0, 0] - latlon[0][1, 0])
    r, c = int((90 - lat) / k_deg), int((lon + 180) / k_deg)
    return r * latlon[0].shape[1] + c


def _rank_of(score, mask, latlon, lat, lon) -> dict | None:
    """Puesto (1 = mejor) de la celda que contiene un punto, entre todas las celdas de tierra."""
    k_deg = abs(latlon[0][0, 0] - latlon[0][1, 0])
    r, c = int((90 - lat) / k_deg), int((lon + 180) / k_deg)
    if not (0 <= r < score.shape[0] and 0 <= c < score.shape[1]) or not np.isfinite(score[r, c]):
        return None
    valid = mask & np.isfinite(score)
    # Puesto pesimista: con empates (todas las celdas de basalto valen 1 en geología) el
    # sitio queda detrás de todas las celdas con el mismo puntaje, no delante
    rank = int(np.count_nonzero(score[valid] >= score[r, c]))
    return {"score": round(float(score[r, c]), 4), "rank": rank, "of": int(valid.sum()),
            "topPct": round(100 * rank / int(valid.sum()), 3)}


def _target_vector(metrics: dict) -> dict:
    """Valores del objetivo (números y la clase litológica), sin los indicadores internos."""
    out = {k: v["value"] for k, v in metrics.items()
           if not k.startswith("_") and isinstance(v.get("value"), (int, float))}
    if "lithology" in metrics:
        out["lithology"] = metrics["lithology"]["value"]
        out["lithologyUnit"] = metrics["lithology"].get("mapUnit")
    return out


def _validation_entry(known: dict, scores: dict, mask, latlon) -> dict:
    """Puesto de un análogo conocido con cada método (previo, actual y solo geología)."""
    entry = dict(known)
    for name, score in scores.items():
        if score is None:
            continue
        ranked = _rank_of(score, mask, latlon, known["lat"], known["lon"])
        if not ranked:
            continue
        if name.startswith("group:"):
            entry.setdefault("byGroup", {})[name.removeprefix("group:")] = ranked
        else:
            entry[name] = ranked
    # Compatibilidad con la app: el puesto principal es el del método actual
    entry.update(entry.get("current", {}))
    return entry


def validation_summary(results: list[dict]) -> dict:
    """Resumen de la validación con los análogos conocidos (elegidos a mano por la comunidad).

    Para cada método: percentil mediano (top X % de las celdas de tierra) y cuántos quedan en
    el 10 % mejor. `bestGroup` es la dimensión en la que cada análogo conocido queda mejor:
    muestra *por qué* es un análogo, aunque el índice global no lo encuentre.
    """
    out = {"methods": {
        "previous": "Método anterior: parámetros físicos (terreno, luz, albedo, suelo, hielo), sin geología",
        "current": "Método actual: parámetros físicos sin los que no distinguen sitios + litología",
        "bestGroup": "La mejor de las dimensiones por separado (iluminación, topografía, hielo o geología)"},
        "bodies": {}, "pairs": []}
    for t in results:
        for k in t.get("knownAnalogs", []):
            row = {"target": t["id"], "targetName": t["name"], "body": t["body"],
                   "targetLithology": t["targetValues"].get("lithology"),
                   "targetMapUnit": t["targetValues"].get("lithologyUnit"),
                   "earth": k["id"], "earthName": k["name"], "earthLithology": k.get("lithology")}
            for m in ("previous", "current"):
                if m in k:
                    row[m] = {"topPct": k[m]["topPct"], "rank": k[m]["rank"], "of": k[m]["of"]}
            groups = k.get("byGroup", {})
            if groups:
                row["byGroup"] = {g: v["topPct"] for g, v in groups.items()}
                best = min(groups, key=lambda g: groups[g]["topPct"])
                row["bestGroup"] = {"group": best, "topPct": groups[best]["topPct"]}
            out["pairs"].append(row)
    for body in ("moon", "mars", None):
        rows = [p for p in out["pairs"] if body is None or p["body"] == body]
        stats = {}
        for m in out["methods"]:
            pct = [p[m]["topPct"] for p in rows if m in p]
            if pct:
                stats[m] = {"medianTopPct": round(float(np.median(pct)), 1),
                            "inTop10Pct": int(sum(v <= 10 for v in pct)), "n": len(pct)}
        out["bodies"][body or "all"] = stats
    return out


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
        known_here = known.get(t["id"], [])
        if known_here:
            scores = {"current": score,
                      "previous": _score(vector, layers, model, t["body"], use_geology=False, exclude=())[0],
                      **_scores_by_group(vector, layers, model, t["body"])}
            known_here = [_validation_entry({**a, "lithology": _cell_value(
                layers, "lithology", _cell_index(latlon, a["lat"], a["lon"])) if "lithology" in layers else None},
                scores, mask, latlon) for a in known_here]
        requirement = model["bodies"][t["body"]]["requirement"]
        req_value = vector.get(requirement["key"])
        results.append({
            **t,
            "targetValues": vector,
            "requirement": {"key": requirement["key"], "value": req_value, "min": requirement["min"],
                            "pass": None if req_value is None else req_value >= requirement["min"]},
            "parametersUsed": used,
            "candidates": _top_candidates(score, mask, latlon, layers, used, n, min_km),
            "knownAnalogs": known_here,
        })
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "earthGrid": {"cellDeg": grid.CELL_DEG, "marsBlockCells": MARS_BLOCK, "minLandPct": MIN_LAND_PCT},
        "targets": results,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out_path


def merge(parts: list[Path], out_path: Path) -> Path:
    """Une los resultados de varias ejecuciones de `search` (p. ej. una por cuerpo) en un archivo."""
    payloads = [json.loads(p.read_text(encoding="utf-8")) for p in parts]
    merged = {**payloads[0], "generatedAt": max(p["generatedAt"] for p in payloads),
              "targets": [t for p in payloads for t in p["targets"]]}
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out_path


def write_validation(candidates_paths: list[Path], out_path: Path) -> dict:
    """Junta los resultados de una o varias ejecuciones de `search` y escribe validation.json."""
    results = []
    for path in candidates_paths:
        results += json.loads(path.read_text(encoding="utf-8"))["targets"]
    summary = validation_summary(results)
    summary["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return summary
