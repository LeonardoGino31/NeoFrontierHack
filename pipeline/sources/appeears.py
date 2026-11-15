"""Días de nieve al año en los sitios de la Tierra (MODIS MOD10A2) mediante NASA AppEEARS.

AppEEARS recorta MODIS por punto y devuelve un CSV pequeño, en lugar de las teselas
globales completas. Necesita una cuenta de Earthdata en EARTHDATA_USERNAME y
EARTHDATA_PASSWORD. Las tareas son asíncronas: si no terminan a tiempo, el id queda en
caché y la próxima ejecución continúa donde quedó.
"""

import csv
import io
import json
import os
import time
from pathlib import Path

import requests

POLL_SECONDS = 30
MAX_WAIT_SECONDS = 15 * 60


def _login(api: str) -> str:
    """Token de AppEEARS a partir de las credenciales de Earthdata del entorno."""
    user, password = os.environ.get("EARTHDATA_USERNAME"), os.environ.get("EARTHDATA_PASSWORD")
    if not user or not password:
        raise PermissionError("Faltan EARTHDATA_USERNAME / EARTHDATA_PASSWORD.")
    response = requests.post(f"{api}/login", auth=(user, password), timeout=60)
    response.raise_for_status()
    return response.json()["token"]


def _submit(api: str, token: str, source: dict, sites: list) -> str:
    """Crea una tarea de muestreo por punto para todos los sitios y devuelve su id."""
    task = {
        "task_type": "point",
        "task_name": "neofrontier-snow",
        "params": {
            "dates": [{"startDate": source["startDate"], "endDate": source["endDate"]}],
            "layers": [{"product": source["product"], "layer": source["layer"]}],
            "coordinates": [{"id": s.id, "latitude": s.lat, "longitude": s.lon} for s in sites],
        },
    }
    response = requests.post(f"{api}/task", json=task, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    response.raise_for_status()
    return response.json()["task_id"]


def _wait(api: str, token: str, task_id: str) -> bool:
    """Espera a que la tarea termine; False si se agota el tiempo."""
    headers = {"Authorization": f"Bearer {token}"}
    deadline = time.time() + MAX_WAIT_SECONDS
    while time.time() < deadline:
        status = requests.get(f"{api}/task/{task_id}", headers=headers, timeout=60).json().get("status")
        if status == "done":
            return True
        if status == "error":
            raise RuntimeError(f"AppEEARS marcó la tarea {task_id} con error.")
        time.sleep(POLL_SECONDS)
    return False


def _results_csv(api: str, token: str, task_id: str) -> str:
    """Descarga el CSV de resultados de la tarea."""
    headers = {"Authorization": f"Bearer {token}"}
    files = requests.get(f"{api}/bundle/{task_id}", headers=headers, timeout=60).json()["files"]
    result = next(f for f in files if f["file_type"] == "csv" and "results" in f["file_name"].lower())
    response = requests.get(f"{api}/bundle/{task_id}/{result['file_id']}", headers=headers, timeout=300)
    response.raise_for_status()
    return response.text


def snow_days(sites: list, cfg: dict, cache_dir: Path) -> dict:
    """Días al año con nieve por sitio: {id: (días, cita)}. Vacío si no hay credenciales o la tarea sigue en curso."""
    source = cfg["sources"]["appeears"]
    api = source["api"]
    state = cache_dir / "appeears_task.json"
    results = cache_dir / "appeears_snow.csv"

    if not results.exists():
        try:
            token = _login(api)
        except PermissionError as error:
            print(f"  · AppEEARS omitido: {error}")
            return {}
        task_id = json.loads(state.read_text())["task_id"] if state.exists() else None
        if not task_id:
            task_id = _submit(api, token, source, sites)
            state.parent.mkdir(parents=True, exist_ok=True)
            state.write_text(json.dumps({"task_id": task_id}))
            print(f"  · AppEEARS: tarea {task_id} enviada")
        if not _wait(api, token, task_id):
            print(f"  · AppEEARS: la tarea {task_id} sigue en curso; vuelve a ejecutar más tarde")
            return {}
        results.write_text(_results_csv(api, token, task_id))

    rows = list(csv.DictReader(io.StringIO(results.read_text())))
    column = next(c for c in rows[0] if c.endswith(source["layer"]))
    periods: dict[str, int] = {}
    for row in rows:
        snow = row[column] and float(row[column]) == source["snowValue"]
        periods[row["ID"]] = periods.get(row["ID"], 0) + int(bool(snow))
    cite = {"dataset": source["dataset"], "url": api}
    return {site_id: (count * source["periodDays"], cite) for site_id, count in periods.items()}
