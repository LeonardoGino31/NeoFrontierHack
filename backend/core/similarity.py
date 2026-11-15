"""Misma fórmula que src/similarity.js: 1 - |Δ|/span por parámetro,
promedio simple por grupo, media ponderada por el peso del grupo según el cuerpo."""

def param_similarity(earth_value: float, analog_value: float, span: float) -> float:
    return max(0.0, 1.0 - abs(earth_value - analog_value) / span)

def score(earth: dict, analog: dict, model: dict, body: str) -> dict:
    """earth/analog: {param_key: valor}. Devuelve índice global y desglose por grupo."""
    weights = model["bodies"][body]["weights"]
    groups = {}
    for p in model["parameters"]:
        k = p["key"]
        if k in earth and k in analog:
            s = param_similarity(earth[k], analog[k], p["span"])
            groups.setdefault(p["group"], []).append(s)
    by_group = {g: sum(v) / len(v) for g, v in groups.items()}
    total_w = sum(weights[g] for g in by_group)
    overall = sum(by_group[g] * weights[g] for g in by_group) / total_w
    return {"overall": overall, "groups": by_group}
