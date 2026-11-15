"""Reproyecta una franja equirectangular del polo sur a una vista polar (desde arriba).

Lo usa scripts/fetch-trek.sh. Se hace en Python porque `-distort Polar` de ImageMagick
no deja controlar con claridad la orientación de las longitudes.

Uso:
  python3 polar_reproject.py franja.png lat_superior radio_grados tamaño salida.jpg
      vista centrada en el polo
  python3 polar_reproject.py franja.png lat_superior --site lat lon ancho_km radio_km tamaño salida.jpg
      recorte cuadrado centrado en un sitio cercano al polo, con el norte arriba
"""

import sys

import numpy as np
from PIL import Image


def _sample(strip: np.ndarray, top_lat: float, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Valores de la franja (−180°…180°, de `top_lat` a −90°) en las coordenadas pedidas."""
    h, w = strip.shape[:2]
    col = ((lon + 180) / 360 * w).astype(int) % w
    row = np.clip(((top_lat - lat) / (top_lat + 90) * h).astype(int), 0, h - 1)
    return strip[row, col]


def south_polar_view(strip: np.ndarray, top_lat: float, radius_deg: float, size: int) -> np.ndarray:
    """Devuelve una imagen cuadrada centrada en el polo sur a partir de una franja equirectangular.

    Convención de mapa polar sur: 0° arriba y 90° E a la derecha.
    """
    c = (size - 1) / 2
    y, x = np.mgrid[0:size, 0:size]
    dx, dy = (x - c) / c, (y - c) / c
    dist = np.hypot(dx, dy)

    out = _sample(strip, top_lat, -90 + dist * radius_deg, np.degrees(np.arctan2(dx, -dy)))
    # Fuera del círculo no hay datos dentro del radio pedido: se deja negro
    out[dist > 1] = 0
    return out


def south_polar_patch(strip: np.ndarray, top_lat: float, lat0: float, lon0: float,
                      width_km: float, radius_km: float, size: int) -> np.ndarray:
    """Recorte de `width_km` centrado en (lat0, lon0), en proyección azimutal desde el polo.

    Cerca del polo el recorte equirectangular se deforma mucho (los meridianos convergen);
    aquí cada píxel mide lo mismo en todas direcciones. Se gira para dejar el norte
    (alejarse del polo) arriba y el este a la derecha, como en los demás recortes.
    """
    km_per_deg = 2 * np.pi * radius_km / 360
    rho0 = 90 + lat0                             # distancia al polo en grados de arco
    lon0r = np.radians(lon0)
    east = np.array([np.cos(lon0r), np.sin(lon0r)])    # derecha en pantalla
    down = np.array([-np.sin(lon0r), np.cos(lon0r)])   # hacia el polo
    center = rho0 * np.array([np.sin(lon0r), -np.cos(lon0r)])

    half = width_km / 2 / km_per_deg
    t = np.linspace(-half, half, size)
    u, v = np.meshgrid(t, t)
    px = center[0] + u * east[0] + v * down[0]
    py = center[1] + u * east[1] + v * down[1]
    return _sample(strip, top_lat, -90 + np.hypot(px, py), np.degrees(np.arctan2(px, -py)))


def main() -> None:
    """Lee los argumentos de la línea de comandos y escribe la vista polar."""
    args = sys.argv[1:]
    strip = np.asarray(Image.open(args[0]).convert("L"))
    top_lat = float(args[1])
    if args[2] == "--site":
        lat0, lon0, width_km, radius_km, size, dst = args[3:9]
        view = south_polar_patch(strip, top_lat, float(lat0), float(lon0),
                                 float(width_km), float(radius_km), int(size))
    else:
        radius, size, dst = args[2:5]
        view = south_polar_view(strip, top_lat, float(radius), int(size))
    Image.fromarray(view).save(dst, quality=88)


if __name__ == "__main__":
    main()
