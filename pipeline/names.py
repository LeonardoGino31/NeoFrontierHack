"""Nombres legibles para puntos de la Luna y Marte con el nomenclátor oficial de la IAU.

Un candidato del backend solo trae un id (`mars-approx-0001`). Aquí se busca el accidente
con nombre aprobado que lo contiene o, si no hay, el más cercano, y la región grande
(mare, planitia, terra…) donde cae: "Cráter Shackleton", "Cerca de Nobile · polo sur".
"""

import math
import zipfile
from functools import lru_cache
from pathlib import Path

from .raster import _download

MIN_INSIDE_KM = 10     # cráteres menores no sirven para ubicar un sitio de 5–30 km
MIN_NEAR_KM = 20
REGION_MIN_KM = 300    # mares, planitiae y terrae que dan contexto regional
SKIP_CODES = {"SF", "AL", "ME"}  # cráteres satélite con letra, sitios de aterrizaje y nombres de prueba
CRATER_CODES = {"CR", "AA"}


@lru_cache(maxsize=2)
def _features(body: str, shp: str) -> list[dict]:
    """Accidentes con nombre (longitud en −180..180)."""
    import shapefile  # pyshp: solo hace falta aquí

    out = []
    for rec in shapefile.Reader(shp).records():
        if rec["code"] in SKIP_CODES or not rec["diameter"]:
            continue
        lon = rec["center_lon"] - 360 if rec["center_lon"] > 180 else rec["center_lon"]
        out.append({"name": rec["clean_name"], "code": rec["code"], "diameter": float(rec["diameter"]),
                    "lat": float(rec["center_lat"]), "lon": lon})
    return out


def _shapefile(body: str, cfg: dict, cache_dir: Path) -> str:
    """Shapefile de centros del nomenclátor, descargado una vez."""
    folder = cache_dir / "geology" / "names" / body.upper()
    shp = folder / f"{body.upper()}_nomenclature_center_pts.shp"
    if not shp.exists():
        archive = folder.with_suffix(".zip")
        if not archive.exists():
            print(f"  · descargando nomenclátor IAU de {body}")
            _download(cfg["sources"]["geology"]["names"][body], archive)
        with zipfile.ZipFile(archive) as z:
            z.extractall(folder, [m for m in z.namelist() if ".." not in m])
    return str(shp)


def _distance_km(lat1, lon1, lat2, lon2, radius_km) -> float:
    """Distancia sobre la superficie de un cuerpo esférico."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * radius_km * math.asin(math.sqrt(min(1.0, a)))


def _label(feature: dict) -> str:
    """Nombre con el tipo en español cuando el nombre IAU no lo incluye (cráteres)."""
    return f"Cráter {feature['name']}" if feature["code"] in CRATER_CODES else feature["name"]


def _ref(feature: dict) -> str:
    """El accidente dentro de una frase: "del cráter X" o "de X"."""
    return f"del cráter {feature['name']}" if feature["code"] in CRATER_CODES else f"de {feature['name']}"


def describe(body: str, lat: float, lon: float, cfg: dict, cache_dir: Path) -> dict:
    """Nombre corto (`name`) y frase de ubicación (`context`) de un punto."""
    radius = cfg["bodies"][body]["radiusKm"]
    feats = []
    for f in _features(body, _shapefile(body, cfg, cache_dir)):
        d = _distance_km(lat, lon, f["lat"], f["lon"], radius)
        feats.append((d - f["diameter"] / 2, f))
    inside = sorted((f for edge, f in feats if edge <= 0 and f["diameter"] >= MIN_INSIDE_KM),
                    key=lambda f: f["diameter"])
    if inside:
        main = inside[0]
        name, context = _label(main), f"Dentro {_ref(main)}"
    else:
        edge, main = min(((e, f) for e, f in feats if e > 0 and f["diameter"] >= MIN_NEAR_KM), key=lambda x: x[0])
        name = f"Cerca {_ref(main)}"
        context = f"A {edge:.0f} km del borde {_ref(main)}"
    # La región más pequeña que contiene el punto: los nombres IAU se aproximan con un círculo,
    # y las regiones enormes (Terra Cimmeria) "contienen" puntos que en realidad no les tocan
    region = next((f for f in inside if f is not main and f["diameter"] >= REGION_MIN_KM
                   and f["diameter"] > main["diameter"] and f["code"] not in CRATER_CODES), None)
    if region:
        name += f" · {region['name']}"
        context += f", en {region['name']}"
    hemi = f"{abs(lat):.2f}° {'S' if lat < 0 else 'N'}, {abs(lon):.2f}° {'O' if lon < 0 else 'E'}"
    return {"name": name, "context": f"{context} ({hemi})"}
