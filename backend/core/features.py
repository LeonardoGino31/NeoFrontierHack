"""Carga el modelo de parámetros (única fuente de verdad, compartida con el frontend)."""
import json
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parents[2] / "public" / "data" / "parameter_model.json"

def load_model(path: Path = MODEL_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)
