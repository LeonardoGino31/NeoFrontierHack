"""Geología de superficie en un vocabulario común para la Tierra, la Luna y Marte.

Cada cuerpo tiene su propio mapa geológico, con unidades que no se pueden comparar
directamente:

- Tierra: GLiM, Global Lithological Map (Hartmann y Moosdorf 2012), malla de 0.5°.
- Luna: Unified Geologic Map of the Moon 1:5M (Fortezzo et al. 2020, USGS), raster 64 px/°.
- Marte: Geologic Map of Mars, SIM 3292 (Tanaka et al. 2014, USGS), polígonos 1:20M.

`geology.json` traduce cada unidad a una clase litológica común (basalto, sedimentario,
brecha de impacto…) y define la afinidad entre la clase del objetivo y la de cada celda de
la Tierra (1 = mismo tipo de roca, 0 = nada en común). La afinidad es una tabla explícita
y revisable, no un valor aprendido: la Tierra no tiene, por ejemplo, superficies de brecha
de impacto a escala regional, y la tabla lo dice con números bajos.
"""

import csv
import json
import re
import zipfile
from collections import Counter
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin

from . import remote_zip
from .earth import grid
from .raster import _download, read_window

HERE = Path(__file__).parent
TABLE = HERE / "geology.json"
MARS_CELL_DEG = 0.05   # ~3 km en el ecuador de Marte: más fino que la escala 1:20M del mapa
MARS_SHAPEFILE = "SIM3292_Global_Geology"
WATER = -1             # lagos y agua interior de GLiM: no son terreno comparable y se excluyen


@lru_cache(maxsize=1)
def table() -> dict:
    """Clases, correspondencias por cuerpo y matriz de afinidad (geology.json)."""
    return json.loads(TABLE.read_text(encoding="utf-8"))


def class_keys() -> list[str]:
    """Claves de las clases; el código numérico de cada una es su posición + 1 (0 = sin dato)."""
    return [c["key"] for c in table()["classes"]]


def class_code(key: str) -> int:
    """Código numérico de una clase."""
    return class_keys().index(key) + 1


def class_label(key: str | None) -> str:
    """Nombre legible de una clase."""
    return next((c["label"] for c in table()["classes"] if c["key"] == key), "sin dato")


def affinity_lut(target_class: str) -> np.ndarray:
    """Afinidad de cada código de la Tierra con la clase del objetivo (índice = código; 0 → NaN)."""
    row = table()["affinity"].get(target_class, {})
    lut = np.full(len(class_keys()) + 1, np.nan, dtype="float32")
    for i, key in enumerate(class_keys(), start=1):
        lut[i] = 1.0 if key == target_class else row.get(key, 0.0)
    return lut


def similarity(earth_codes: np.ndarray, target_class: str) -> np.ndarray:
    """Similitud geológica (0–1) de cada celda de la Tierra; NaN donde no hay dato o es agua."""
    codes = np.nan_to_num(earth_codes, nan=0).astype("int64")
    return affinity_lut(target_class)[np.clip(codes, 0, None)]


def unit_class(body: str, unit: str) -> str | None:
    """Clase común de una unidad de un mapa geológico (None si la unidad no se usa)."""
    rules = table()["bodies"][body]
    if unit in rules.get("units", {}):
        return rules["units"][unit]
    for rule in rules.get("patterns", []):
        if re.fullmatch(rule["regex"], unit):
            return rule["class"]
    return None


# --- Tierra -----------------------------------------------------------------------------

def _glim_ascii(cfg: dict, cache_dir: Path) -> Path:
    """Malla GLiM de 0.5° (ESRI ASCII), descargada y extraída una vez."""
    folder = cache_dir / "geology" / "glim"
    path = folder / cfg["sources"]["geology"]["earth"]["member"]
    if not path.exists():
        archive = folder.with_suffix(".zip")
        print("  · descargando GLiM (PANGAEA)")
        _download(cfg["sources"]["geology"]["earth"]["url"], archive)
        with zipfile.ZipFile(archive) as z:
            z.extract(path.name, folder)
    return path


def earth_layer(cfg: dict, cache_dir: Path) -> np.ndarray:
    """Clase litológica (código) de cada celda de 0.05°; `WATER` en lagos, NaN sin dato."""
    with rasterio.open(_glim_ascii(cfg, cache_dir)) as src:
        glim = src.read(1)
        nodata = src.nodata
    lookup = np.zeros(int(glim.max()) + 1, dtype="float32")
    for code, key in table()["bodies"]["earth"]["glim"].items():
        lookup[int(code)] = class_code(key) if key else 0
    lookup[int(table()["bodies"]["earth"]["glimWater"])] = WATER
    codes = np.where(glim == nodata, 0, lookup[np.clip(glim, 0, None)])
    # Cada celda de 0.5° cubre 10 × 10 celdas de la malla: copia por bloques, sin interpolar
    factor = int(round(0.5 / grid.CELL_DEG))
    fine = np.repeat(np.repeat(codes, factor, axis=0), factor, axis=1)
    return np.where(fine != 0, fine, np.nan).astype("float32")


def run_earth(cfg: dict, cache_dir: Path) -> Path:
    """Agrega la capa `lithology` a la malla de la Tierra."""
    target = Path(cfg["earthGrid"]["file"])
    earth = grid.load(target)
    earth["lithology"] = earth_layer(cfg, cache_dir)
    grid.save(target, earth)
    return target


# --- Luna y Marte -----------------------------------------------------------------------

def _moon_raster(cfg: dict, cache_dir: Path) -> tuple[Path, dict[int, str]]:
    """GeoTIFF numérico del mapa lunar y la unidad de cada valor (DN)."""
    src = cfg["sources"]["geology"]["moon"]
    folder = cache_dir / "geology" / "moon"
    tif, units_csv = folder / src["raster"], folder / src["units"]
    remote_zip.extract(src["url"], [src["raster"], src["units"]], folder)
    units = {}
    with units_csv.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            units[int(row[src["dnColumn"]])] = row[src["unitColumn"]].strip()
    return tif, units


def _mars_raster(cfg: dict, cache_dir: Path) -> tuple[Path, dict[int, str]]:
    """Rasteriza una vez los polígonos de SIM 3292 a 0.05° y guarda la unidad de cada código."""
    import shapefile  # pyshp: solo hace falta aquí

    folder = cache_dir / "geology" / "mars"
    tif, legend = folder / "sim3292_units.tif", folder / "sim3292_units.json"
    if tif.exists() and legend.exists():
        return tif, {int(k): v for k, v in json.loads(legend.read_text()).items()}
    names = [f"{MARS_SHAPEFILE}.{ext}" for ext in ("shp", "shx", "dbf", "prj")]
    remote_zip.extract(cfg["sources"]["geology"]["mars"]["url"], names, folder)
    reader = shapefile.Reader(str(folder / MARS_SHAPEFILE))
    units = sorted({rec["Unit"] for rec in reader.records()})
    code = {u: i for i, u in enumerate(units, start=1)}
    width, height = int(360 / MARS_CELL_DEG), int(180 / MARS_CELL_DEG)
    transform = from_origin(-180, 90, MARS_CELL_DEG, MARS_CELL_DEG)
    print(f"  · rasterizando {len(reader)} polígonos de SIM 3292")
    shapes = ((sr.shape.__geo_interface__, code[sr.record["Unit"]]) for sr in reader.iterShapeRecords())
    data = rasterize(shapes, out_shape=(height, width), transform=transform, fill=0, dtype="uint8")
    crs = (folder / f"{MARS_SHAPEFILE}.prj").read_text()
    with rasterio.open(tif, "w", driver="GTiff", width=width, height=height, count=1, dtype="uint8",
                       crs=crs, transform=transform, nodata=0, compress="deflate") as dst:
        dst.write(data, 1)
    legend.write_text(json.dumps({i: u for u, i in code.items()}))
    return tif, {i: u for u, i in code.items()}


def site_geology(site, cfg: dict, cache_dir: Path) -> dict:
    """Unidad dominante del mapa geológico en la ventana del sitio y su clase común.

    Se usa la unidad más extendida de la ventana: a la escala de estos mapas (1:5M y 1:20M)
    una ventana de 5–20 km suele caer en una o dos unidades.
    """
    if site.body not in ("moon", "mars"):
        return {}
    tif, units = (_moon_raster if site.body == "moon" else _mars_raster)(cfg, cache_dir)
    window = cfg["windows"][site.pair_body]
    data = read_window([str(tif)], site.lat, site.lon, window["sizeKm"], window["resolutionM"] * 4,
                       cache_dir, resampling=Resampling.nearest)
    values = data[np.isfinite(data) & (data > 0)].astype("int64")
    counts = Counter(units.get(int(v)) for v in values)
    counts.pop(None, None)
    if not counts:
        return {}
    unit, n = counts.most_common(1)[0]
    cls = unit_class(site.body, unit)
    if cls is None:
        return {}
    src = cfg["sources"]["geology"][site.body]
    return {"lithology": {
        "value": cls, "unit": "clase", "status": "measured", "mapUnit": unit,
        "note": f"unidad {unit} ({100 * n / sum(counts.values()):.0f} % de la ventana) → {class_label(cls)}",
        "source": {"dataset": src["dataset"], "url": src["page"]}}}
