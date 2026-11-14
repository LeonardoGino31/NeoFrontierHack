"""Reúne las métricas de cada sitio llamando a las fuentes que le corresponden."""

from pathlib import Path

from .metrics import annual_sunlit_pct, ice_index, moon_near_side_earth_view_pct
from .sources import appeears, dem, mcd, moon_maps

DERIVED_GEOMETRY = {"dataset": "Cálculo geométrico (latitud y oblicuidad del cuerpo, horizonte plano)"}


def _is_moon_polar(site, cfg: dict) -> bool:
    """Los sitios bajo el límite polar usan los mapas de iluminación de LOLA."""
    return site.body == "moon" and site.lat < cfg["thresholds"]["moonPolarBelowLatDeg"]


def _illumination(site, cfg: dict, cache_dir: Path) -> dict:
    """Luz solar (y Tierra visible en la Luna).

    Polos lunares: mapas de LOLA, que incluyen las sombras del relieve. Resto de la Luna:
    geometría (día y noche de ~14 días, 50 %). En la Tierra y Marte la geometría con
    horizonte plano da ~50 % en cualquier latitud, así que no distingue sitios: queda
    pendiente hasta calcular el horizonte con el DEM.
    """
    if _is_moon_polar(site, cfg):
        return moon_maps.polar_illumination(site, cfg, cache_dir)
    if site.body != "moon":
        return {}
    sunlight = annual_sunlit_pct(site.lat, cfg["bodies"]["moon"]["obliquityDeg"])
    return {
        "sunlight": {"value": round(sunlight, 1), "unit": "%", "status": "derived", "source": DERIVED_GEOMETRY},
        "earthView": {"value": moon_near_side_earth_view_pct(site.lat, site.lon), "unit": "%",
                      "status": "derived", "source": DERIVED_GEOMETRY,
                      "note": "cara visible = 100 %, sin libración"},
    }


def _ice(site, cfg: dict, metrics: dict, snow: dict) -> dict:
    """Índice de hielo con los indicadores disponibles; la confianza dice cuántos faltan."""
    indicators = {}
    shadow = metrics.pop("_permanentShadow", None)
    if shadow:
        indicators["permanentShadow"] = shadow["value"]
    if site.body == "earth" and site.id in snow:
        days, _ = snow[site.id]
        indicators["snowDays"] = days >= cfg["thresholds"]["earthSnowDaysForIce"]

    result = ice_index(indicators, cfg["ice"]["indicators"][site.body])
    if result is None:
        return {}
    index, confidence = result
    note = ", ".join(f"{k}={'sí' if v else 'no'}" for k, v in indicators.items())
    return {
        "ice": {"value": round(index), "unit": "pts", "status": "derived", "note": note,
                "source": shadow["source"] if shadow else snow[site.id][1]},
        "iceConfidence": {"value": round(confidence), "unit": "%", "status": "derived",
                          "note": "indicadores medidos ÷ indicadores esperados"},
    }


def collect_site(site, cfg: dict, cache_dir: Path, snow: dict) -> dict:
    """Todas las métricas disponibles de un sitio. Una fuente que falla no detiene a las demás."""
    metrics, errors = {}, {}
    steps = [("topography", lambda: dem.topography(site, cfg, cache_dir)),
             ("illumination", lambda: _illumination(site, cfg, cache_dir))]
    if site.body == "mars":
        steps.append(("descentDensity", lambda: mcd.descent_density(site, cfg, cache_dir)))

    for name, step in steps:
        try:
            metrics.update(step())
        except Exception as error:  # noqa: BLE001 — se registra y se sigue con el resto
            errors[name] = f"{type(error).__name__}: {error}"
    metrics.update(_ice(site, cfg, metrics, snow))

    window = cfg["windows"][site.pair_body]
    return {"body": site.body, "name": site.name, "lat": site.lat, "lon": site.lon,
            "window": window, "metrics": metrics, **({"errors": errors} if errors else {})}


def collect(sites: list, cfg: dict, cache_dir: Path, use_appeears: bool = True) -> dict:
    """Métricas de todos los sitios, indexadas por `cuerpo:id`."""
    earth_sites = [s for s in sites if s.body == "earth"]
    snow = appeears.snow_days(earth_sites, cfg, cache_dir) if use_appeears and earth_sites else {}

    out = {}
    for site in sites:
        print(f"- {site.body}:{site.id} ({site.name})")
        out[f"{site.body}:{site.id}"] = collect_site(site, cfg, cache_dir, snow)
        for name, error in out[f"{site.body}:{site.id}"].get("errors", {}).items():
            print(f"  ! {name}: {error}")
    return out
