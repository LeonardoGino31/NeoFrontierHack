"""Cálculos puros sobre ventanas ya descargadas: no hacen red ni leen archivos."""

import math

import numpy as np


def relief_m(dem: np.ndarray) -> float:
    """Desnivel de la ventana: percentil 98 menos percentil 2, en metros.

    Se usan percentiles y no máx − mín para que un píxel erróneo no domine el valor.
    """
    p2, p98 = np.nanpercentile(dem, [2, 98])
    return float(p98 - p2)


def slope_deg(dem: np.ndarray, resolution_m: float) -> np.ndarray:
    """Pendiente de cada píxel en grados, por diferencias finitas sobre la malla."""
    dz_dy, dz_dx = np.gradient(dem, resolution_m)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def slope_limit_deg(resolution_m: float, table: list[dict]) -> float:
    """Límite de pendiente según la resolución: un píxel grande suaviza las pendientes."""
    for row in sorted(table, key=lambda r: r["maxResolutionM"]):
        if resolution_m <= row["maxResolutionM"]:
            return row["limitDeg"]
    raise ValueError(f"No hay límite de pendiente para {resolution_m} m/px.")


def safe_slope_pct(slopes: np.ndarray, limit_deg: float) -> float:
    """Porcentaje de píxeles válidos con pendiente menor que el límite."""
    valid = ~np.isnan(slopes)
    if not valid.any():
        raise ValueError("La ventana no tiene píxeles válidos.")
    return float(100 * np.count_nonzero(slopes[valid] < limit_deg) / valid.sum())


def annual_sunlit_pct(lat_deg: float, obliquity_deg: float, steps: int = 360) -> float:
    """Porcentaje del año con el Sol sobre el horizonte, sin relieve (horizonte plano).

    Promedia la duración del día sobre la longitud solar (Ls) uniforme; ignora la
    excentricidad de la órbita, que cambia el resultado en pocos puntos porcentuales.
    """
    phi = math.radians(lat_deg)
    total = 0.0
    for i in range(steps):
        ls = 2 * math.pi * i / steps
        decl = math.asin(math.sin(math.radians(obliquity_deg)) * math.sin(ls))
        x = -math.tan(phi) * math.tan(decl)
        # |x| > 1: noche o día polar continuo
        total += 0.0 if x >= 1 else 1.0 if x <= -1 else math.acos(x) / math.pi
    return 100 * total / steps


def moon_near_side_earth_view_pct(lat_deg: float, lon_deg: float) -> float:
    """Visibilidad de la Tierra fuera de los polos: 100 % en la cara visible, 0 % en la oculta.

    La libración mueve el borde unos 7°, así que solo vale para sitios lejos del limbo.
    """
    facing = math.cos(math.radians(lat_deg)) * math.cos(math.radians(lon_deg))
    return 100.0 if facing > 0 else 0.0


def ice_index(indicators: dict, expected: list[str]) -> tuple[float, float] | None:
    """Índice de hielo (0–100) y confianza (0–100) a partir de indicadores booleanos.

    El índice promedia los indicadores disponibles; la confianza es la fracción de los
    esperados que se pudo medir. Devuelve None si no hay ninguno.
    """
    available = [indicators[k] for k in expected if indicators.get(k) is not None]
    if not available:
        return None
    index = 100 * sum(bool(v) for v in available) / len(available)
    confidence = 100 * len(available) / len(expected)
    return index, confidence


def local_relief_m(dem: np.ndarray) -> np.ndarray:
    """Desnivel en la vecindad 3 × 3 de cada píxel (máximo − mínimo).

    Es la regla común de "obstáculo" en la Tierra, Marte y la Luna: un píxel con mucho
    desnivel alrededor es una pared de cráter, un escarpe o un campo de bloques.
    """
    padded = np.pad(dem, 1, mode="edge")
    h, w = dem.shape
    stack = np.stack([padded[i:i + h, j:j + w] for i in range(3) for j in range(3)])
    return np.nanmax(stack, axis=0) - np.nanmin(stack, axis=0)


def obstacle_limit_m(resolution_m: float, table: list[dict]) -> float:
    """Desnivel local que convierte un píxel en obstáculo, según la resolución."""
    for row in sorted(table, key=lambda r: r["maxResolutionM"]):
        if resolution_m <= row["maxResolutionM"]:
            return row["limitM"]
    raise ValueError(f"No hay límite de obstáculo para {resolution_m} m/px.")


def obstacle_free_pct(dem: np.ndarray, limit_m: float) -> float:
    """Porcentaje de píxeles válidos cuyo desnivel local no supera el límite."""
    lr = local_relief_m(dem)
    valid = ~np.isnan(lr)
    if not valid.any():
        raise ValueError("La ventana no tiene píxeles válidos.")
    return float(100 * np.count_nonzero(lr[valid] <= limit_m) / valid.sum())
