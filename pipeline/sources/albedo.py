"""Albedo de la Luna (LOLA, 1064 nm) y de Marte (TES, bolométrico), promediado en la ventana del sitio.

Luna: mapas de albedo normal de LOLA (PDS). En |lat| ≥ `polarFromLatDeg` se usa el mapa
polar de 1 km (cubre las regiones en sombra con datos nocturnos del láser); en el resto,
el global de 10 px/°. LOLA mide a 1064 nm, en el infrarrojo cercano: da valores ~1.5–2
veces mayores que el albedo visible, así que compararlo con el albedo de onda corta de la
Tierra sesga la búsqueda hacia superficies terrestres más claras.

Marte: albedo bolométrico de TES (7.4 km/px), comparable con el albedo de onda corta
(MCD43C3) de la malla de la Tierra.
"""

from pathlib import Path

import numpy as np

from ..raster import _download, read_window


def _pds_local(source: dict, cache_dir: Path) -> str:
    """Copia local de un mapa PDS3 (etiqueta + imagen) y la ruta de su etiqueta.

    La etiqueta nombra la imagen en mayúsculas y el servidor la sirve en minúsculas:
    GDAL solo la encuentra si la copia local usa el nombre de la etiqueta.
    """
    folder = cache_dir / "files" / "ldam"
    label = folder / source["label"].rsplit("/", 1)[-1]
    image = folder / source["imageName"]
    if not label.exists():
        _download(source["label"], label)
    if not image.exists():
        print(f"  · descargando {image.name}")
        _download(source["image"], image)
    return str(label)


def _mean_in_window(path_or_url: str, site, cfg: dict, cache_dir: Path) -> float:
    """Promedio del mapa en la ventana de la pareja del sitio."""
    window = cfg["windows"][site.pair_body]
    data = read_window([path_or_url], site.lat, site.lon, window["sizeKm"], window["resolutionM"], cache_dir)
    with np.errstate(all="ignore"):
        value = float(np.nanmean(data))
    if not np.isfinite(value):
        raise ValueError(f"el mapa no tiene datos en ({site.lat}, {site.lon})")
    return value


def albedo(site, cfg: dict, cache_dir: Path) -> dict:
    """Métrica `albedo` del sitio de la Luna o Marte."""
    if site.body == "moon":
        maps = cfg["sources"]["moonAlbedo"]
        polar = abs(site.lat) >= maps["polarFromLatDeg"]
        source = maps["south" if site.lat < 0 else "north"] if polar else maps["global"]
        value = _mean_in_window(_pds_local(source, cache_dir), site, cfg, cache_dir)
        note = "albedo normal a 1064 nm (infrarrojo cercano): mayor que el visible"
        dataset, url = maps["dataset"], source["image"]
    elif site.body == "mars":
        source = cfg["sources"]["marsAlbedo"]
        value = _mean_in_window(source["url"], site, cfg, cache_dir)
        note = "albedo bolométrico; píxel de 7.4 km"
        dataset, url = source["dataset"], source["url"]
    else:
        return {}
    return {"albedo": {"value": round(value, 3), "unit": "", "status": "measured", "note": note,
                       "source": {"dataset": dataset, "url": url}}}
