"""Add transparent, provisional factor estimates to candidate-only CSV rows.

The script does not alter the candidate selection or its filters. It only fills
descriptive factor values and records how each value was obtained.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "public/data/planetary_candidates.csv"
MODEL_PATH = ROOT / "public/data/parameter_model.json"
METADATA_COLUMN = "candidate_factor_metadata_json"

SOURCES = {
    "moon": {
        "dem": "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif",
        "albedo": "https://astrogeology.usgs.gov/search/map/moon_clementine_uvvis_global_mosaic_118m",
        "ice": "https://astrogeology.usgs.gov/search/map/moon_ice_favorability_index_south_pole_591mp",
    },
    "mars": {
        "dem": "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif",
        "albedo": "https://tes.mars.asu.edu/products/",
        "ice": "https://swim.psi.edu/SWIM4MIMProducts.php",
    },
}


def number(row: dict[str, str], key: str, default: float = 0.0) -> float:
    try:
        return float(row.get(key, ""))
    except (TypeError, ValueError):
        return default


def clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


def confidence_label(value: float) -> str:
    if value >= 80:
        return "media"
    if value >= 50:
        return "baja"
    return "muy baja"


def mars_annual_daylight_percent(latitude_degrees: float) -> float:
    """Annual mean fraction of a sol with the Sun above a flat horizon.

    Integrates the sunrise hour angle over areocentric solar longitude, with
    time weighting for Mars' eccentric orbit. It does not model terrain or dust.
    """
    obliquity = math.radians(25.19)
    eccentricity = 0.0934
    perihelion_ls = math.radians(251.0)
    latitude = math.radians(max(-90.0, min(90.0, latitude_degrees)))
    weighted_daylight = 0.0
    total_weight = 0.0
    samples = 3600
    for index in range(samples):
        solar_longitude = 2.0 * math.pi * (index + 0.5) / samples
        true_anomaly = solar_longitude - perihelion_ls
        time_weight = (1.0 - eccentricity**2) ** 1.5 / (
            1.0 + eccentricity * math.cos(true_anomaly)
        ) ** 2
        declination = math.asin(
            math.sin(obliquity) * math.sin(solar_longitude)
        )
        hour_angle_cosine = -math.tan(latitude) * math.tan(declination)
        hour_angle_cosine = max(-1.0, min(1.0, hour_angle_cosine))
        daylight_fraction = math.acos(hour_angle_cosine) / math.pi
        weighted_daylight += daylight_fraction * time_weight
        total_weight += time_weight
    return 100.0 * weighted_daylight / total_weight


def main() -> None:
    model: dict[str, Any] = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    albedo_ranges = {
        body: parameter["ranges"][body]
        for parameter in model["parameters"]
        if parameter["key"] == "albedo"
        for body in ("moon", "mars")
    }
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if METADATA_COLUMN not in fieldnames:
        fieldnames.append(METADATA_COLUMN)

    for row in rows:
        if row.get("record_type") != "candidate_only":
            continue
        try:
            previous_metadata = json.loads(row.get(METADATA_COLUMN) or "{}")
        except json.JSONDecodeError:
            previous_metadata = {}
        body = row["body"]
        latitude = number(row, "analog_latitude")
        relief = max(0.0, number(row, "relief_analog"))
        safe_slope = clamp(number(row, "safe_slope_analog"))
        albedo_low, albedo_high = albedo_ranges[body]
        albedo = (float(albedo_low) + float(albedo_high)) / 2
        mars_daylight = mars_annual_daylight_percent(latitude) if body == "mars" else None

        # A topographic screening heuristic, not a count of mapped craters.
        crater_free = clamp(safe_slope * (1 - min(relief, 2000.0) / 2000.0))
        # A trafficability proxy combining gentle terrain and low local relief.
        relief_proxy = clamp(100 - min(relief, 2000.0) / 20.0)
        soil_stability = clamp(0.7 * safe_slope + 0.3 * relief_proxy)

        metadata: dict[str, Any] = {
            "albedo": {
                "value": round(albedo, 5),
                "score_0_100": None,
                "unit": "fracción de referencia",
                "kind": "neutral_range_midpoint",
                "confidence": "muy baja",
                "method": (
                    "Punto medio del rango configurado para este cuerpo en "
                    "parameter_model.json; no se muestreó un raster local."
                ),
                "source": "Rango de referencia del modelo de la aplicación; valor provisional uniforme por cuerpo.",
                "planned_source_url": SOURCES[body]["albedo"],
                "limitation": "No representa albedo medido en estas coordenadas ni debe compararse como reflectancia espectral equivalente entre cuerpos.",
                "score_note": "El modelo del proyecto no define si un albedo mayor o menor es favorable; por eso no se inventa un puntaje de idoneidad.",
            },
            "craterFree": {
                "value": round(crater_free, 2),
                "score_0_100": round(crater_free, 2),
                "unit": "% proxy",
                "kind": "terrain_hazard_proxy",
                "confidence": "baja",
                "method": "pendiente_segura_% × (1 − min(desnivel_m, 2000) / 2000); heurística de relieve para cribado.",
                "source": "Pendiente segura y desnivel del análisis DEM existente.",
                "source_url": SOURCES[body]["dem"],
                "limitation": "No se consultó un inventario de cráteres ni rocas; no es porcentaje real libre de cráteres.",
            },
            "soilStability": {
                "value": round(soil_stability, 2),
                "score_0_100": round(soil_stability, 2),
                "unit": "pts proxy",
                "kind": "terrain_trafficability_proxy",
                "confidence": "baja",
                "method": "0.7 × pendiente_segura_% + 0.3 × max(0, 100 − min(desnivel_m, 2000) / 20).",
                "source": "Pendiente segura y desnivel del análisis DEM existente.",
                "source_url": SOURCES[body]["dem"],
                "limitation": "No hay mediciones geotécnicas de cohesión, granulometría, resistencia portante ni hundimiento.",
            },
        }
        if mars_daylight is not None:
            metadata["sunlight"] = {
                "value": round(mars_daylight, 2),
                "score_0_100": round(mars_daylight, 2),
                "unit": "% del sol marciano",
                "kind": "annual_geometric_daylight_estimate",
                "confidence": "baja",
                "method": "Promedio anual geométrico del ángulo horario de salida/puesta del Sol usando latitud, oblicuidad (25,19°) y estaciones ponderadas por la órbita excéntrica de Marte.",
                "source": "Cálculo geométrico inspirado en las convenciones estacionales Ls de Mars24.",
                "source_url": "https://www.giss.nasa.gov/tools/mars24/help/notes.html",
                "limitation": "Fracción del sol con el Sol sobre un horizonte plano; no es energía solar (W/m²), ni incluye relieve local, polvo atmosférico, tormentas o período de misión.",
            }
            row["sunlight_analog"] = str(round(mars_daylight, 2))

        try:
            existing_ice = float(row.get("ice_analog", ""))
        except (TypeError, ValueError):
            existing_ice = None
        try:
            existing_ice_confidence = float(row.get("ice_confidence_analog", ""))
        except (TypeError, ValueError):
            existing_ice_confidence = None

        previous_ice_kind = previous_metadata.get("ice", {}).get("kind")
        has_direct_ice_data = (
            existing_ice is not None
            and previous_ice_kind != "latitude_only_ice_proxy"
            and (body == "moon" or previous_ice_kind == "swim_ice_consistency_raster")
            and row.get("candidate_status") != "ice_unassessed"
        )
        if has_direct_ice_data:
            ice = existing_ice
            ice_confidence = existing_ice_confidence or 0.0
            ice_metadata = {
                "value": round(ice, 5),
                "score_0_100": round(ice, 5),
                "unit": "favorabilidad relativa (0–100)",
                "kind": "usgs_ice_favorability_raster" if body == "moon" else previous_ice_kind,
                "confidence": confidence_label(ice_confidence),
                "confidence_percent": round(ice_confidence, 2),
                "method": "Valor del raster de hielo existente; la confianza resume cobertura y coherencia local del raster.",
                "source": "USGS Moon Ice Favorability Index (IFI)." if body == "moon" else "SWIM4IMIM ice consistency product.",
                "source_url": SOURCES[body]["ice"],
                "limitation": "El indicador es predictivo/consistencia, no mide cantidad de hielo ni es probabilidad calibrada de presencia.",
            }
        else:
            if body == "moon":
                ice = clamp((abs(latitude) - 50.0) * 4.0)
                method = "Proxy latitudinal fuera de la cobertura polar del IFI: max(0, (|latitud| − 50°) × 4)."
                limitation = "Estimación muy básica por latitud; no hay raster de hielo muestreado en esta ubicación."
                ice_confidence = 15.0
            else:
                ice = clamp((abs(latitude) - 30.0) * (100.0 / 30.0))
                method = "Proxy latitudinal provisional: max(0, (|latitud| − 30°) × 100 / 30)."
                limitation = "Aunque SWIM cubre aproximadamente 60°S–60°N, su raster no está ingerido en esta corrida; el proxy se usa en todos los puntos marcianos."
                ice_confidence = 10.0
            ice = round(ice, 2)
            ice_metadata = {
                "value": ice,
                "score_0_100": ice,
                "unit": "pts proxy (0–100)",
                "kind": "latitude_only_ice_proxy",
                "confidence": "muy baja",
                "confidence_percent": ice_confidence,
                "method": method,
                "source": "Estimación geométrica por latitud; no es una medición orbital del hielo.",
                "reference_source_url": SOURCES[body]["ice"],
                "limitation": limitation,
            }
            row["ice_analog"] = str(ice)
            row["ice_confidence_analog"] = str(ice_confidence)

        row["albedo_analog"] = str(round(albedo, 5))
        row["crater_free_analog"] = str(round(crater_free, 2))
        row["soil_stability_analog"] = str(round(soil_stability, 2))
        metadata["ice"] = ice_metadata
        row[METADATA_COLUMN] = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))
        try:
            group_scores = json.loads(row.get("candidate_group_scores_json") or "{}")
        except json.JSONDecodeError:
            group_scores = {}
        if group_scores.get("ice") is None:
            group_scores["ice"] = ice_metadata["score_0_100"]
        if mars_daylight is not None and group_scores.get("illumination") is None:
            group_scores["illumination"] = round(mars_daylight, 2)
        row["candidate_group_scores_json"] = json.dumps(
            group_scores, ensure_ascii=False, separators=(",", ":")
        )

    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Factores descriptivos actualizados en {CSV_PATH}")


if __name__ == "__main__":
    main()
