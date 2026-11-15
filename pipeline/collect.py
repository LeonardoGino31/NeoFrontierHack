"""Reúne las métricas de cada sitio llamando a las fuentes que le corresponden."""

from pathlib import Path

from .metrics import annual_sunlit_pct, ice_index, moon_near_side_earth_view_pct
from .sources import albedo, appeears, dem, diviner, earth_grid, mars_ice, mcd, moon_maps

DERIVED_GEOMETRY = {"dataset": "Cálculo geométrico (latitud y oblicuidad del cuerpo, horizonte plano)"}


def _is_moon_polar(site, cfg: dict) -> bool:
    """Los sitios bajo el límite polar usan los mapas de iluminación de LOLA."""
    return site.body == "moon" and site.lat < cfg["thresholds"]["moonPolarBelowLatDeg"]


def _illumination(site, cfg: dict, cache_dir: Path) -> dict:
    """Luz solar (y Tierra visible en la Luna).

    Polos lunares: mapas de LOLA, que incluyen las sombras del relieve. Resto de la Luna y
    Marte: geometría con horizonte plano. En Marte se toma el cielo como despejado (casi no
    hay nubes fuera de los casquetes) para compararlo con "día × cielo despejado" de la
    Tierra. En la Tierra el valor de cada sitio sale de la malla de MODIS, no de aquí.
    """
    if _is_moon_polar(site, cfg):
        return moon_maps.polar_illumination(site, cfg, cache_dir)
    if site.body == "mars":
        sunlight = annual_sunlit_pct(site.lat, cfg["bodies"]["mars"]["obliquityDeg"])
        return {"sunlight": {"value": round(sunlight, 1), "unit": "%", "status": "derived",
                             "source": DERIVED_GEOMETRY,
                             "note": "cielo despejado; no descuenta el polvo"}}
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
    hydrogen = metrics.pop("_marsHydrogen", None)
    if hydrogen:
        indicators["odysseyHydrogen"] = hydrogen["value"]
    if site.body == "earth" and site.id in snow:
        days, _ = snow[site.id]
        indicators["snowDays"] = days >= cfg["thresholds"]["earthSnowDaysForIce"]

    result = ice_index(indicators, cfg["ice"]["indicators"][site.body])
    if result is None:
        return {}
    index, confidence = result
    note = ", ".join(f"{k}={'sí' if v else 'no'}" for k, v in indicators.items())
    if hydrogen:
        note += f" ({hydrogen['note']})"
    source = (shadow or hydrogen)["source"] if (shadow or hydrogen) else snow[site.id][1]
    return {
        "ice": {"value": round(index), "unit": "pts", "status": "derived", "note": note,
                "source": source},
        "iceConfidence": {"value": round(confidence), "unit": "%", "status": "derived",
                          "note": "indicadores medidos ÷ indicadores esperados"},
    }


def collect_site(site, cfg: dict, cache_dir: Path, snow: dict) -> dict:
    """Todas las métricas disponibles de un sitio. Una fuente que falla no detiene a las demás."""
    metrics, errors = {}, {}
    steps = [("topography", lambda: dem.topography(site, cfg, cache_dir)),
             ("illumination", lambda: _illumination(site, cfg, cache_dir))]
    if site.body == "mars":
        steps.append(("descent", lambda: mcd.descent_density(site, cfg, cache_dir)))
        steps.append(("ice", lambda: mars_ice.hydrogen_indicator(site, cfg, cache_dir)))
    if site.body in ("moon", "mars"):
        steps.append(("albedo", lambda: albedo.albedo(site, cfg, cache_dir)))
    if site.body == "moon":
        steps.append(("soil", lambda: diviner.soil_stability(site, cfg, cache_dir)))
    if site.body == "earth":
        steps.append(("modis", lambda: earth_grid.grid_values(site, cfg)))

    for name, step in steps:
        try:
            metrics.update(step())
        except Exception as error:  # noqa: BLE001 — se registra y se sigue con el resto
            errors[name] = f"{type(error).__name__}: {error}"
    measured = metrics.pop("_iceIndicatorsMeasured", 1)
    if "ice" in metrics:
        # La malla ya da el índice (nieve y, donde hay mapa, permafrost)
        expected = cfg["ice"]["indicators"][site.body]
        metrics["iceConfidence"] = {"value": round(100 * measured / len(expected)), "unit": "%", "status": "derived",
                                    "note": "indicadores medidos ÷ indicadores esperados"}
    else:
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
