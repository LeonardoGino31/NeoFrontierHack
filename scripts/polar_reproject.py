"""Reproyecta una franja equirectangular del polo sur a una vista polar (desde arriba).

Lo usa scripts/fetch-trek.sh. Se hace en Python porque `-distort Polar` de ImageMagick
no deja controlar con claridad la orientación de las longitudes.

Uso: python3 polar_reproject.py franja.png lat_superior radio_grados tamaño salida.jpg
"""

import sys

import numpy as np
from PIL import Image


def south_polar_view(strip: np.ndarray, top_lat: float, radius_deg: float, size: int) -> np.ndarray:
    """Devuelve una imagen cuadrada centrada en el polo sur a partir de una franja equirectangular.

    La franja cubre todas las longitudes (−180°…180°) desde `top_lat` hasta −90°.
    Convención de mapa polar sur: 0° arriba y 90° E a la derecha.
    """
    h, w = strip.shape[:2]
    c = (size - 1) / 2
    y, x = np.mgrid[0:size, 0:size]
    dx, dy = (x - c) / c, (y - c) / c
    dist = np.hypot(dx, dy)

    lat = -90 + dist * radius_deg
    lon = np.degrees(np.arctan2(dx, -dy))
    col = ((lon + 180) / 360 * w).astype(int) % w
    row = np.clip(((top_lat - lat) / (top_lat + 90) * h).astype(int), 0, h - 1)

    out = strip[row, col]
    # Fuera del círculo no hay datos dentro del radio pedido: se deja negro
    out[dist > 1] = 0
    return out


def main() -> None:
    """Lee los argumentos de la línea de comandos y escribe la vista polar."""
    src, top_lat, radius, size, dst = sys.argv[1:6]
    strip = np.asarray(Image.open(src).convert("L"))
    view = south_polar_view(strip, float(top_lat), float(radius), int(size))
    Image.fromarray(view).save(dst, quality=88)


if __name__ == "__main__":
    main()
