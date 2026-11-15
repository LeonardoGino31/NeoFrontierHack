"""Malla global de la Tierra en celdas de 0.05° (~5 km) y su almacenamiento.

Cada variable es una matriz de 3600 × 7200 (filas de norte a sur, columnas de oeste a
este). Las celdas sin dato (mar, sin cobertura) son NaN.
"""

from pathlib import Path

import numpy as np

CELL_DEG = 0.05
ROWS, COLS = int(180 / CELL_DEG), int(360 / CELL_DEG)
CELLS_PER_DEG = int(round(1 / CELL_DEG))


def tile_slice(lat_floor: int, lon_floor: int) -> tuple[slice, slice]:
    """Filas y columnas de la malla que cubre una tesela de 1° con esquina SO (lat, lon)."""
    row0 = (90 - (lat_floor + 1)) * CELLS_PER_DEG
    col0 = (lon_floor + 180) * CELLS_PER_DEG
    return slice(row0, row0 + CELLS_PER_DEG), slice(col0, col0 + CELLS_PER_DEG)


def cell_center(row: np.ndarray, col: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Latitud y longitud del centro de las celdas indicadas."""
    return 90 - (row + 0.5) * CELL_DEG, -180 + (col + 0.5) * CELL_DEG


def cell_index(lat: float, lon: float) -> tuple[int, int]:
    """Celda que contiene un punto."""
    return int((90 - lat) / CELL_DEG), int((lon + 180) / CELL_DEG) % COLS


def empty(fields: list[str]) -> dict[str, np.ndarray]:
    """Malla vacía (todo NaN) con las variables indicadas."""
    return {name: np.full((ROWS, COLS), np.nan, dtype="float32") for name in fields}


def save(path: Path, grid: dict[str, np.ndarray]) -> None:
    """Guarda la malla comprimida; las celdas de mar comprimen casi a cero."""
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **grid)


def load(path: Path) -> dict[str, np.ndarray]:
    """Lee una malla guardada con `save`."""
    with np.load(path) as data:
        return {name: data[name] for name in data.files}


def combine_ice(earth: dict[str, np.ndarray]) -> None:
    """Índice de hielo de cada celda: el mayor entre nieve y permafrost (0–100).

    Basta una de las dos formas de hielo; el máximo, y no el promedio, hace que un desierto
    frío con permafrost y sin nieve cuente como helado, que es el análogo del hielo
    enterrado de Marte y la Luna. Las mallas viejas guardaban la nieve en `ice`.
    """
    if "snow" not in earth and "ice" in earth:
        earth["snow"] = earth["ice"]
    if "snow" not in earth:
        return
    if "permafrost" in earth:
        with np.errstate(all="ignore"):
            earth["ice"] = np.fmax(earth["snow"], earth["permafrost"]).astype("float32")
    else:
        earth["ice"] = earth["snow"]
