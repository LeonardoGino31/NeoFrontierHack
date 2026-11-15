"""Variables globales de MODIS para la malla de la Tierra (requiere cuenta de Earthdata).

Se usan solo los productos globales de baja resolución (0.05° y 1°): son 12 archivos
pequeños por año y producto, en lugar de miles de teselas de 500 m.

  - ice:           meses con nieve ≥ 50 % de la celda (MOD10CM), escalado a 0–100
                   (100 = nieve al menos `earthSnowDaysForIce` días al año)
  - sunlight:      % del año con el Sol sobre el horizonte y cielo despejado
                   (geometría × (1 − nubosidad de MOD08_M3))
  - soilStability: inercia térmica aparente (1 − albedo) / (T día − T noche), de MOD11C3
                   y MCD43C3, escalada a 0–100 con los percentiles 5 y 95 de la Tierra

Credenciales: earthaccess las lee de ~/.netrc o de EARTHDATA_USERNAME/EARTHDATA_PASSWORD.
"""

import math
from pathlib import Path

import numpy as np

from ..metrics import annual_sunlit_pct
from . import grid

PRODUCTS = {
    "snow": {"short_name": "MOD10CM", "version": "61", "sds": "Snow_Cover_Monthly_CMG"},
    "cloud": {"short_name": "MOD08_M3", "version": "6.1", "sds": "Cloud_Fraction_Mean_Mean"},
    "lst": {"short_name": "MOD11C3", "version": "061", "sds": ["LST_Day_CMG", "LST_Night_CMG"]},
    "albedo": {"short_name": "MCD43C3", "version": "061", "sds": "Albedo_WSA_shortwave"},
}


def _download(key: str, year: int, cache_dir: Path, days: list[str] | None = None) -> list[Path]:
    """Descarga (una vez) los archivos de un producto para el año; `days` limita a esas fechas."""
    import earthaccess  # solo hace falta en este comando

    folder = cache_dir / "earth" / "modis" / key
    existing = sorted(folder.glob("*.hdf"))
    if existing and len(existing) >= (len(days) if days else 12):
        return existing
    earthaccess.login()
    product = PRODUCTS[key]
    if days:
        granules = []
        for day in days:
            granules += earthaccess.search_data(short_name=product["short_name"], version=product["version"],
                                                temporal=(day, day))[:1]
    else:
        granules = earthaccess.search_data(short_name=product["short_name"], version=product["version"],
                                           temporal=(f"{year}-01-01", f"{year}-12-31"))
    folder.mkdir(parents=True, exist_ok=True)
    return sorted(Path(p) for p in earthaccess.download(granules, str(folder)))


def _read(path: Path, sds_name: str) -> np.ndarray:
    """Lee una variable de un archivo HDF4 de MODIS, aplicando escala, offset y valores inválidos."""
    from pyhdf.SD import SD, SDC

    hdf = SD(str(path), SDC.READ)
    try:
        sds = hdf.select(sds_name)
    except Exception as error:
        raise KeyError(f"{path.name} no tiene {sds_name}; tiene: {sorted(hdf.datasets())}") from error
    attrs = sds.attributes()
    data = sds.get().astype("float32")
    fill = attrs.get("_FillValue")
    if fill is not None:
        data[data == fill] = np.nan
    valid = attrs.get("valid_range")
    if valid is not None:
        data[(data < valid[0]) | (data > valid[1])] = np.nan
    scale, offset = attrs.get("scale_factor", 1.0), attrs.get("add_offset", 0.0)
    # MOD08 usa la convención (dato − offset) × escala; el resto, dato × escala
    if "MOD08" in path.name:
        return (data - offset) * scale
    return data * scale + offset if "MOD10" not in path.name else data


def _to_grid(data: np.ndarray) -> np.ndarray:
    """Lleva una malla global (de norte a sur, de −180° a 180°) a la de 0.05° de la app."""
    if data.shape == (grid.ROWS, grid.COLS):
        return data
    fy, fx = grid.ROWS // data.shape[0], grid.COLS // data.shape[1]
    return np.repeat(np.repeat(data, fy, axis=0), fx, axis=1)


def _monthly_daylight(lat: np.ndarray, month: int) -> np.ndarray:
    """Fracción del día con el Sol sobre el horizonte a mitad de mes (horizonte plano)."""
    ls = 2 * math.pi * (month - 3 + 0.5) / 12  # equinoccio de marzo ≈ Ls 0
    decl = math.asin(math.sin(math.radians(23.44)) * math.sin(ls))
    x = np.clip(-np.tan(np.radians(lat)) * math.tan(decl), -1, 1)
    return np.arccos(x) / np.pi


def ice_layer(year: int, cache_dir: Path, snow_days_for_ice: int) -> np.ndarray:
    """Índice de hielo 0–100 a partir de los meses con nieve de cada celda."""
    months = [_to_grid(_read(p, PRODUCTS["snow"]["sds"])) for p in _download("snow", year, cache_dir)]
    stack = np.stack(months)
    snowy = np.nansum(stack >= 50, axis=0).astype("float32")
    snowy[np.all(np.isnan(stack), axis=0)] = np.nan
    return np.clip(100 * snowy * 30.4 / snow_days_for_ice, 0, 100)


def sunlight_layer(year: int, cache_dir: Path) -> np.ndarray:
    """% del año con Sol y cielo despejado (nubosidad mensual de MOD08 a 1°)."""
    files = _download("cloud", year, cache_dir)
    lat = 90 - (np.arange(grid.ROWS) + 0.5) * grid.CELL_DEG
    total = np.zeros((grid.ROWS, grid.COLS), dtype="float32")
    for month, path in enumerate(files, start=1):
        cloud = _to_grid(_read(path, PRODUCTS["cloud"]["sds"]))
        total += _monthly_daylight(lat, month)[:, None] * (1 - cloud)
    return 100 * total / len(files)


def soil_layer(year: int, cache_dir: Path) -> np.ndarray:
    """Inercia térmica aparente escalada a 0–100 (estimación: compacto alto, suelto bajo)."""
    lst_files = _download("lst", year, cache_dir)
    days = [f"{year}-{m:02d}-15" for m in range(1, 13)]
    albedo_files = _download("albedo", year, cache_dir, days)
    amplitude = np.nanmean(np.stack([_read(p, "LST_Day_CMG") - _read(p, "LST_Night_CMG") for p in lst_files]), axis=0)
    albedo = np.nanmean(np.stack([_read(p, PRODUCTS["albedo"]["sds"]) for p in albedo_files]), axis=0)
    with np.errstate(all="ignore"):
        ati = (1 - _to_grid(albedo)) / np.where(_to_grid(amplitude) > 1, _to_grid(amplitude), np.nan)
    lo, hi = np.nanpercentile(ati, [5, 95])
    return np.clip(100 * (ati - lo) / (hi - lo), 0, 100)


def run(cfg: dict, cache_dir: Path, year: int = 2024) -> Path:
    """Calcula las tres capas y las agrega a la malla de la Tierra."""
    target = Path(cfg["earthGrid"]["file"])
    earth = grid.load(target) if target.exists() else {}
    print("  · hielo (MOD10CM)")
    earth["ice"] = ice_layer(year, cache_dir, cfg["thresholds"]["earthSnowDaysForIce"]).astype("float32")
    print("  · luz solar con cielo despejado (MOD08_M3)")
    earth["sunlight"] = sunlight_layer(year, cache_dir).astype("float32")
    print("  · estabilidad del suelo (MOD11C3 + MCD43C3)")
    earth["soilStability"] = soil_layer(year, cache_dir).astype("float32")
    grid.save(target, earth)
    return target
