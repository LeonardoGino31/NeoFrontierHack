"""Hielo cerca de la superficie de Marte según el espectrómetro de rayos gamma de Mars Odyssey.

El mapa de agua de GRS (5° × 5°, primeros ~50 cm) cubre de ~55° S a ~55° N. Dentro de esa
franja el agua medida (2–7 % en peso) es sobre todo de minerales hidratados, no de hielo:
el máximo está en el ecuador. Por eso el indicador solo es positivo donde GRS ve hielo:
  - celdas enmascaradas en latitudes altas: el modelo de GRS las excluye porque el
    hidrógeno es tan alto que solo lo explica hielo (zona confirmada por Phoenix), o
  - agua equivalente ≥ `marsIceWehPct`.
El hielo enterrado a varios metros (SWIM) no se detecta aquí.
"""

from pathlib import Path

import requests

NO_DATA = 9000  # el archivo usa 9999.999 para las celdas sin dato
POLAR_MASK_LAT = 50  # más allá, una celda sin dato es la región de hielo excluida del modelo


def _table(source: dict, cache_dir: Path) -> dict[tuple[float, float], float | None]:
    """Agua (% en peso) por centro de celda (lat, lon 0–360); None donde GRS no da valor."""
    path = cache_dir / "files" / source["url"].rsplit("/", 1)[-1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(requests.get(source["url"], timeout=60).text)
    table = {}
    for line in path.read_text().splitlines():
        lat, lon, value = (float(x) for x in line.split()[:3])
        table[(lat, lon)] = None if value > NO_DATA else value
    return table


def hydrogen_indicator(site, cfg: dict, cache_dir: Path) -> dict:
    """Indicador interno `_marsHydrogen` (bool) para el índice de hielo del sitio."""
    source = cfg["sources"]["marsGrsWater"]
    lat_c = min(87.5, max(-87.5, (site.lat // 5) * 5 + 2.5))
    lon_c = ((site.lon % 360) // 5) * 5 + 2.5
    weh = _table(source, cache_dir).get((lat_c, lon_c))
    if weh is None:
        ice = abs(site.lat) >= POLAR_MASK_LAT
        note = "sin dato de GRS: " + ("región polar de hielo" if ice else "celda enmascarada")
    else:
        ice = weh >= cfg["thresholds"]["marsIceWehPct"]
        note = f"agua equivalente {weh:.1f} % en peso"
    return {"_marsHydrogen": {"value": ice, "note": note,
                              "source": {"dataset": source["dataset"], "url": source["url"]}}}
