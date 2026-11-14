"""Densidad del aire en Marte desde la Mars Climate Database (servicio web del LMD)."""

import json
import re
from pathlib import Path

import requests

DENSITY_RE = re.compile(r"Density \(kg/m3\) \.+ ([0-9.eE+-]+)")


def _density(source: dict, lat: float, lon: float, ls: float, cache_dir: Path) -> float:
    """Densidad (kg/m³) a la altura y hora local configuradas, para una estación (Ls)."""
    cached = cache_dir / "mcd" / f"{lat}_{lon}_{ls}_{source['localTimeH']}_{source['altitudeM']}.json"
    if cached.exists():
        return json.loads(cached.read_text())["density"]

    params = dict(var1="rho", datekeyhtml=1, ls=ls, localtime=source["localTimeH"],
                  latitude=lat, longitude=lon, altitude=source["altitudeM"], zkey=3,
                  isfixedlt="on", dust=1, hrkey=1)
    # El servicio tarda ~10 s por consulta
    html = requests.get(source["url"], params=params, timeout=180).text
    match = DENSITY_RE.search(html)
    if not match:
        raise ValueError(f"La MCD no devolvió densidad para ({lat}, {lon}, Ls {ls}).")
    density = float(match.group(1))
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps({"density": density}))
    return density


def descent_density(site, cfg: dict, cache_dir: Path) -> dict:
    """Peor caso de densidad del año: el mínimo de las estaciones configuradas."""
    source = cfg["sources"]["mcd"]
    values = {ls: _density(source, site.lat, site.lon, ls, cache_dir) for ls in source["seasonsLs"]}
    worst_ls = min(values, key=values.get)
    return {
        "descentDensity": {
            "value": round(values[worst_ls], 5), "unit": "kg/m³", "status": "estimated",
            "source": {"dataset": source["dataset"], "url": source["url"]},
            "note": f"mínimo en Ls {worst_ls}° a las {source['localTimeH']} h, {source['altitudeM']} m sobre el suelo",
        }
    }
