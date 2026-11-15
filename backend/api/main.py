"""API de solo lectura para buscar análogos terrestres.

Ejecutar (desde backend/): uvicorn api.main:app --reload
"""
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException

from core.data import load_all
from core.similarity import score

app = FastAPI(title="Terra2Mars analogs")
MODEL, CANDIDATES, EARTH_CELLS = load_all()


@app.get("/sites")
def sites(body: Optional[str] = None):
    items = [c for c in CANDIDATES.values() if body in (None, c["body"])]
    return [{k: c[k] for k in ("id", "body", "name", "lat", "lon", "data_status")} for c in items]


@app.get("/analogs")
def analogs(site: str, n: int = 10):
    cand = CANDIDATES.get(site)
    if not cand:
        raise HTTPException(404, f"Sitio desconocido: {site}")
    ranked = []
    for cell in EARTH_CELLS.values():
        s = score(cell["metrics"], cand["metrics"], MODEL, cand["body"])
        ranked.append({
            "cell_id": cell["id"], "name": cell["name"], "region": cell["region"],
            "lat": cell["lat"], "lon": cell["lon"],
            "similarity": round(s["overall"], 4),
            "groups": {g: round(v, 4) for g, v in s["groups"].items()},
            "data_status": cell["data_status"],
        })
    ranked.sort(key=lambda x: x["similarity"], reverse=True)
    return {"site": site, "body": cand["body"], "results": ranked[: max(1, n)]}


@app.get("/cell/{cell_id}")
def cell(cell_id: str):
    c = EARTH_CELLS.get(cell_id)
    if not c:
        raise HTTPException(404, f"Celda desconocida: {cell_id}")
    return c
