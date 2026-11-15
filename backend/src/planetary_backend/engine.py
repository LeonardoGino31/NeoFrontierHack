"""Raster preparation, approximate metric derivation, scoring and GeoJSON export."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.warp import reproject


BODY_RADII_KM = {"moon": 1737.4, "mars": 3389.5}
LAYER_KEYS = (
    "sunlight",
    "albedo",
    "craterFree",
    "soilStability",
    "ice",
    "iceConfidence",
    "earthView",
)


class AnalysisError(RuntimeError):
    """Raised when an input raster or manifest cannot be analyzed safely."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AnalysisError(f"No se encontró el archivo: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AnalysisError(f"JSON inválido en {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise AnalysisError(f"Se esperaba un objeto JSON en {path}.")
    return data


def _read_resampled_dem(
    dem_config: dict[str, Any], manifest_path: Path, radius_km: float, grid_km: float
) -> tuple[np.ndarray, Any, Any, dict[str, Any]]:
    dem_path = _resolve_path(manifest_path.parent, dem_config.get("path"))
    if not dem_path.is_file():
        raise AnalysisError(
            f"No se encontró el DEM {dem_path}. Descárgalo con `planetary-backend download-dem --body ... --accept-large-download`."
        )

    band = int(dem_config.get("band", 1))
    scale = float(dem_config.get("scale", 1))
    offset = float(dem_config.get("offset", 0))
    with rasterio.open(dem_path) as dataset:
        if band < 1 or band > dataset.count:
            raise AnalysisError(f"La banda {band} no existe en {dem_path}.")
        grid_info = _validate_planetary_grid(dataset, dem_path, radius_km)
        if abs(dataset.transform.b) > 1e-12 or abs(dataset.transform.d) > 1e-12:
            raise AnalysisError("El DEM debe usar una cuadrícula planetaria sin rotación.")

        if grid_info["kind"] == "equirectangular":
            pixel_km = abs(dataset.transform.a) / (
                1000 * math.cos(math.radians(grid_info["lat_ts"]))
            )
        else:
            pixel_km = math.radians(abs(dataset.transform.a)) * radius_km
        if pixel_km <= 0:
            raise AnalysisError("No se pudo determinar el tamaño de píxel del DEM.")
        factor = max(1, int(round(grid_km / pixel_km)))
        out_width = max(1, int(math.ceil(dataset.width / factor)))
        out_height = max(1, int(math.ceil(dataset.height / factor)))
        masked = dataset.read(
            band,
            out_shape=(out_height, out_width),
            masked=True,
            resampling=Resampling.average,
        ).astype(np.float32)
        dem = np.asarray(masked.filled(np.nan), dtype=np.float32)
        dem = dem * scale + offset
        transform = dataset.transform * Affine.scale(
            dataset.width / out_width, dataset.height / out_height
        )
        crs = dataset.crs
        nodata = dataset.nodata
        bounds = tuple(float(value) for value in dataset.bounds)
        profile = {
            "path": str(dem_path),
            "band": band,
            "scale": scale,
            "offset": offset,
            "units": dem_config.get("units", "m"),
            "source_id": dem_config.get("source_id", "unspecified-dem"),
            "source_url": dem_config.get("source_url"),
            "native_size": [dataset.width, dataset.height],
            "analysis_size": [out_width, out_height],
            "native_pixel_km_at_equator": round(pixel_km, 4),
            "effective_grid_km_at_equator": round(
                pixel_km * factor, 4
            ),
            "nodata": nodata,
            "bounds": bounds,
            "crs": str(crs),
            "grid_kind": grid_info["kind"],
            "projection_parameters": grid_info.get("parameters"),
        }
    if dem_config.get("units", "m").lower() in {"km", "kilometer", "kilometers"}:
        dem = dem * 1000.0
        profile["units"] = "m (converted from km)"
    elif dem_config.get("units", "m").lower() not in {"m", "meter", "meters"}:
        raise AnalysisError("La elevación del DEM debe estar expresada en metros o kilómetros.")
    return dem, transform, crs, profile


def _validate_planetary_grid(
    dataset: rasterio.DatasetReader, path: Path, body_radius_km: float
) -> dict[str, Any]:
    if dataset.crs is None:
        raise AnalysisError(f"{path} no tiene un CRS o proyección planetaria definida.")
    if dataset.width < 3 or dataset.height < 3:
        raise AnalysisError(f"La cuadrícula de {path} debe tener al menos 3 x 3 píxeles.")
    return _grid_info(dataset.crs, body_radius_km, path)


def _grid_info(crs: Any, body_radius_km: float, path: Path | None = None) -> dict[str, Any]:
    if crs.is_geographic:
        return {"kind": "geographic", "radius_km": body_radius_km}

    parameters = crs.to_dict()
    if crs.is_projected and parameters.get("proj") in {"eqc", "stere"}:
        units = parameters.get("units", "m")
        if units not in {"m", "metre", "meter"}:
            label = f"{path} " if path else ""
            raise AnalysisError(f"{label}usa una proyección planetaria que no está expresada en metros.")
        projected_radius_km = float(parameters.get("R", parameters.get("a", 0))) / 1000
        if projected_radius_km <= 0:
            label = f"{path} " if path else ""
            raise AnalysisError(f"{label}no declara el radio del cuerpo en su CRS.")
        if abs(projected_radius_km - body_radius_km) / body_radius_km > 0.05:
            label = f"{path} " if path else ""
            raise AnalysisError(f"{label}declara un radio incompatible con el cuerpo seleccionado.")
        if parameters.get("proj") == "stere":
            if abs(abs(float(parameters.get("lat_0", 0))) - 90) > 0.01:
                label = f"{path} " if path else ""
                raise AnalysisError(f"{label}usa una proyección estereográfica que no está centrada en un polo.")
            return {
                "kind": "polar_stereographic",
                "radius_km": projected_radius_km,
                "parameters": parameters,
            }
        lat_ts = float(parameters.get("lat_ts", 0))
        if abs(math.cos(math.radians(lat_ts))) < 0.1:
            label = f"{path} " if path else ""
            raise AnalysisError(f"{label}usa un paralelo estándar inadecuado para esta malla global.")
        return {
            "kind": "equirectangular",
            "radius_km": projected_radius_km,
            "lat_ts": lat_ts,
            "parameters": parameters,
        }

    label = f"{path} " if path else "El raster "
    raise AnalysisError(
        f"{label}debe usar coordenadas geográficas o una proyección equirectangular simple del cuerpo."
    )


def _resolve_path(base: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise AnalysisError("Falta la ruta del archivo raster en el manifiesto.")
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (base / path).resolve()


def _read_metric_layer(
    key: str,
    config: dict[str, Any],
    manifest_path: Path,
    shape: tuple[int, int],
    transform: Any,
    crs: Any,
    radius_km: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    sources = config.get("sources")
    if sources is None:
        sources = [config]
    if not isinstance(sources, list) or not sources:
        raise AnalysisError(f"La capa {key} necesita una ruta o una lista no vacía de fuentes.")

    combined = np.full(shape, np.nan, dtype=np.float32)
    source_details = []
    for source_config in sources:
        if not isinstance(source_config, dict):
            raise AnalysisError(f"Cada fuente de la capa {key} debe ser un objeto.")
        path = _resolve_path(manifest_path.parent, source_config.get("path"))
        if not path.is_file():
            raise AnalysisError(f"No se encontró la capa {key}: {path}")
        band = int(source_config.get("band", config.get("band", 1)))
        scale = float(source_config.get("scale", config.get("scale", 1)))
        offset = float(source_config.get("offset", config.get("offset", 0)))

        with rasterio.open(path) as dataset:
            if band < 1 or band > dataset.count:
                raise AnalysisError(f"La banda {band} no existe en la capa {key} ({path}).")
            _validate_planetary_grid(dataset, path, radius_km)
            raster_scale = float(dataset.scales[band - 1]) if dataset.scales else 1.0
            raster_offset = float(dataset.offsets[band - 1]) if dataset.offsets else 0.0
            destination = np.full(shape, np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(dataset, band),
                destination=destination,
                src_transform=dataset.transform,
                src_crs=dataset.crs,
                src_nodata=dataset.nodata,
                dst_transform=transform,
                dst_crs=crs,
                dst_nodata=np.nan,
                resampling=Resampling.bilinear,
            )
            destination = (destination * raster_scale + raster_offset) * scale + offset
            valid = np.isfinite(destination) & ~np.isfinite(combined)
            combined[valid] = destination[valid]
            source_details.append(
                {
                    "path": str(path),
                    "source_id": source_config.get("source_id", config.get("source_id", key)),
                    "source_url": source_config.get("source_url", config.get("source_url")),
                    "data_url": source_config.get("data_url"),
                    "units": source_config.get("units", config.get("units")),
                    "coverage": source_config.get("coverage"),
                    "native_resolution_m": source_config.get("native_resolution_m"),
                    "band": band,
                    "scale": scale,
                    "offset": offset,
                    "raster_scale": raster_scale,
                    "raster_offset": raster_offset,
                    "effective_scale": raster_scale * scale,
                    "effective_offset": raster_offset * scale + offset,
                    "native_size": [dataset.width, dataset.height],
                    "crs": str(dataset.crs),
                }
            )
    details = {
        "units": config.get("units"),
        "normalization": config.get("normalization"),
        "mosaic_sources": source_details,
        "valid_cell_count": int(np.count_nonzero(np.isfinite(combined))),
    }
    normalization = config.get("normalization")
    if normalization == "joint_minmax":
        valid_values = combined[np.isfinite(combined)]
        if valid_values.size:
            minimum = float(np.min(valid_values))
            maximum = float(np.max(valid_values))
            details["normalization_input_minimum"] = minimum
            details["normalization_input_maximum"] = maximum
            if maximum > minimum:
                combined = (combined - minimum) * (100.0 / (maximum - minimum))
            else:
                # A constant product has no relative ranking information.
                combined[np.isfinite(combined)] = 50.0
            details["normalized_range"] = [0, 100]
    elif normalization not in (None, ""):
        raise AnalysisError(
            f"Normalización no reconocida para {key}: {normalization!r}."
        )
    return combined, details


def _derive_ice_confidence(ice: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    """Estimate local representativeness from ice-layer coverage and coherence.

    This is a data-quality score at the analysis-grid scale, not a probability
    that water ice is present. It uses a 3x3 neighborhood; at high latitudes
    the east-west footprint narrows with the geographic analysis grid.
    """
    valid = np.isfinite(ice)
    values = np.where(valid, ice, 0.0).astype(np.float32)
    total = np.zeros(ice.shape, dtype=np.float32)
    total_squares = np.zeros(ice.shape, dtype=np.float32)
    sample_count = np.zeros(ice.shape, dtype=np.float32)

    for row_offset in (-1, 0, 1):
        for column_offset in (-1, 0, 1):
            source_rows = slice(max(0, -row_offset), min(ice.shape[0], ice.shape[0] - row_offset))
            source_columns = slice(
                max(0, -column_offset), min(ice.shape[1], ice.shape[1] - column_offset)
            )
            target_rows = slice(max(0, row_offset), min(ice.shape[0], ice.shape[0] + row_offset))
            target_columns = slice(
                max(0, column_offset), min(ice.shape[1], ice.shape[1] + column_offset)
            )
            neighborhood_valid = valid[source_rows, source_columns]
            neighborhood_values = values[source_rows, source_columns]
            total[target_rows, target_columns] += neighborhood_values
            total_squares[target_rows, target_columns] += neighborhood_values**2
            sample_count[target_rows, target_columns] += neighborhood_valid

    mean = np.divide(
        total,
        sample_count,
        out=np.zeros(ice.shape, dtype=np.float32),
        where=sample_count > 0,
    )
    variance = np.divide(
        total_squares,
        sample_count,
        out=np.zeros(ice.shape, dtype=np.float32),
        where=sample_count > 0,
    ) - mean**2
    standard_deviation = np.sqrt(np.maximum(variance, 0.0))
    coverage_percent = sample_count * (100.0 / 9.0)
    coherence_percent = np.clip(100.0 * (1.0 - standard_deviation / 50.0), 0.0, 100.0)
    confidence = coverage_percent * coherence_percent / 100.0
    confidence[~valid] = np.nan
    details = {
        "units": "pts",
        "method": "3x3 local coverage multiplied by spatial coherence",
        "formula": "coverage_percent * (1 - local_stddev / 50)",
        "neighborhood_cells": 9,
        "data_quality_proxy": True,
        "not_probability": True,
        "derived_from": "ice",
        "valid_cell_count": int(np.count_nonzero(np.isfinite(confidence))),
    }
    return confidence.astype(np.float32), details


def _filter_result(value: float | None, rule: dict[str, Any]) -> dict[str, Any]:
    operator = rule["operator"]
    threshold = float(rule["threshold"])
    if value is None:
        return {
            "status": "not_evaluated",
            "value": None,
            "operator": operator,
            "threshold": threshold,
            "unit": rule.get("unit"),
            "label": rule.get("label"),
            "required": bool(rule.get("required", False)),
        }
    passed = value >= threshold if operator == "gte" else value <= threshold
    return {
        "status": "passed" if passed else "failed",
        "value": value,
        "operator": operator,
        "threshold": threshold,
        "unit": rule.get("unit"),
        "label": rule.get("label"),
        "required": bool(rule.get("required", False)),
    }


def _apply_hard_filters(
    eligible: np.ndarray,
    metric_values: dict[str, np.ndarray],
    profile: dict[str, Any],
    loaded_layers: set[str],
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    filtered = eligible.copy()
    summary = []
    for rule in profile.get("hard_filters", []):
        key = rule.get("key")
        operator = rule.get("operator")
        threshold = float(rule.get("threshold", 0))
        if key not in metric_values or operator not in {"gte", "lte"}:
            raise AnalysisError(f"Filtro inválido para {key!r}; se requiere una métrica y gte/lte.")
        values = metric_values[key]
        valid = np.isfinite(values)
        available = bool(valid.any())
        required = bool(rule.get("required", False))
        if not available:
            configured_without_coverage = key in loaded_layers and bool(
                rule.get("require_coverage", False)
            )
            reject_all = required or configured_without_coverage
            summary.append(
                {
                    "key": key,
                    "label": rule.get("label"),
                    "operator": operator,
                    "threshold": threshold,
                    "unit": rule.get("unit"),
                    "required": required,
                    "status": (
                        "missing_required"
                        if required
                        else "configured_no_coverage"
                        if configured_without_coverage
                        else "not_available"
                    ),
                    "evaluated_cells": 0,
                    "rejected_cells": 0,
                    "source_layer_configured": key in loaded_layers,
                }
            )
            if reject_all:
                filtered[:] = False
            continue
        passed = values >= threshold if operator == "gte" else values <= threshold
        current = filtered.copy()
        observed = current & valid
        rejected_values = observed & ~passed
        rejected_missing = current & ~valid if rule.get("require_coverage", False) else np.zeros_like(current)
        rejected = rejected_values | rejected_missing
        keep = passed & valid
        if not rule.get("require_coverage", False):
            keep |= ~valid
        filtered &= keep
        summary.append(
            {
                "key": key,
                "label": rule.get("label"),
                "operator": operator,
                "threshold": threshold,
                "unit": rule.get("unit"),
                "required": required,
                "status": "applied",
                "evaluated_cells": int(np.count_nonzero(observed)),
                "rejected_cells": int(np.count_nonzero(rejected)),
                "rejected_for_missing_data": int(np.count_nonzero(rejected_missing)),
                "remaining_cells": int(np.count_nonzero(filtered)),
                "source_layer_configured": key in loaded_layers,
            }
        )
    return filtered, summary


def _ice_alternative_masks(
    base_eligible: np.ndarray,
    metric_values: dict[str, np.ndarray],
    profile: dict[str, Any],
    configured_layers: set[str],
    confidence_derived_from_ice: bool,
    near_miss_margin: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Find near misses just below ice threshold and cells with unknown ice data.

    Near misses must have a measured ice score within ``near_miss_margin`` of
    its threshold and satisfy every other evaluated filter. Unassessed cells
    must lack ice coverage while satisfying the other evaluated filters.
    """
    shape = base_eligible.shape
    ice_values = metric_values.get("ice", np.full(shape, np.nan, dtype=np.float32))
    ice_valid = np.isfinite(ice_values)
    ice_rule = next(
        (item for item in profile.get("hard_filters", []) if item.get("key") == "ice"),
        None,
    )
    if ice_rule:
        threshold = float(ice_rule.get("threshold", 0))
        near_miss = (
            base_eligible
            & ice_valid
            & (ice_values < threshold)
            & (ice_values >= threshold - near_miss_margin)
        )
    else:
        near_miss = np.zeros(shape, dtype=bool)
    unassessed = base_eligible & ~ice_valid

    for rule in profile.get("hard_filters", []):
        key = rule.get("key")
        if key == "ice":
            continue
        if key == "iceConfidence" and confidence_derived_from_ice:
            # This value is unavailable wherever the ice layer has no coverage.
            values = metric_values.get(key)
            if values is None or not np.isfinite(values).any():
                near_miss[:] = False
                continue
            valid = np.isfinite(values)
            threshold = float(rule.get("threshold", 0))
            passed = values >= threshold if rule.get("operator") == "gte" else values <= threshold
            near_miss &= valid & passed
            continue

        values = metric_values.get(key)
        if values is None:
            if rule.get("required"):
                near_miss[:] = False
                unassessed[:] = False
            continue
        valid = np.isfinite(values)
        if not valid.any():
            coverage_required = key in configured_layers and bool(rule.get("require_coverage"))
            if rule.get("required") or coverage_required:
                near_miss[:] = False
                unassessed[:] = False
            continue

        threshold = float(rule.get("threshold", 0))
        passed = values >= threshold if rule.get("operator") == "gte" else values <= threshold
        must_have_data = bool(rule.get("required")) or (
            key in configured_layers and bool(rule.get("require_coverage"))
        )
        condition = valid & passed if must_have_data else (~valid | passed)
        near_miss &= condition
        unassessed &= condition

    return near_miss, unassessed


def _window_statistics(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return 3x3 local min, max and valid-sample count without wrapping at edges."""
    padded = np.pad(values, 1, mode="constant", constant_values=np.nan)
    height, width = values.shape
    local_min = np.full(values.shape, np.inf, dtype=np.float32)
    local_max = np.full(values.shape, -np.inf, dtype=np.float32)
    valid_count = np.zeros(values.shape, dtype=np.uint8)
    for row_offset in range(3):
        for col_offset in range(3):
            window = padded[row_offset : row_offset + height, col_offset : col_offset + width]
            valid = np.isfinite(window)
            local_min = np.minimum(local_min, np.where(valid, window, np.inf))
            local_max = np.maximum(local_max, np.where(valid, window, -np.inf))
            valid_count += valid
    local_min[valid_count == 0] = np.nan
    local_max[valid_count == 0] = np.nan
    return local_min, local_max, valid_count


def _derive_terrain(
    dem_m: np.ndarray,
    transform: Any,
    crs: Any,
    radius_km: float,
    safe_limit_deg: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Derive approximate local relief and safe-slope area percent."""
    info = _grid_info(crs, radius_km)
    latitudes = _latitude_vector(dem_m.shape[0], transform, info)
    if info["kind"] == "equirectangular":
        dy_m = abs(float(transform.e))
        dx_m = abs(float(transform.a)) * np.abs(np.cos(np.radians(latitudes))) / math.cos(
            math.radians(info["lat_ts"])
        )
    else:
        dy_m = math.radians(abs(float(transform.e))) * radius_km * 1000
        dx_m = (
            math.radians(abs(float(transform.a)))
            * radius_km
            * 1000
            * np.abs(np.cos(np.radians(latitudes)))
        )
    dx_m = np.maximum(dx_m, 1.0)

    safe_dem = np.where(np.isfinite(dem_m), dem_m, np.nan)
    dz_dy = np.gradient(safe_dem, dy_m, axis=0)
    dz_dx = np.gradient(safe_dem, axis=1) / dx_m[:, None]
    slope_deg = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy))).astype(np.float32)

    min_elevation, max_elevation, relief_count = _window_statistics(safe_dem)
    relief = max_elevation - min_elevation
    relief[relief_count < 5] = np.nan

    padded_slope = np.pad(slope_deg, 1, mode="constant", constant_values=np.nan)
    height, width = slope_deg.shape
    safe_count = np.zeros((height, width), dtype=np.uint8)
    valid_count = np.zeros((height, width), dtype=np.uint8)
    for row_offset in range(3):
        for col_offset in range(3):
            window = padded_slope[
                row_offset : row_offset + height, col_offset : col_offset + width
            ]
            valid = np.isfinite(window)
            valid_count += valid
            safe_count += valid & (window <= safe_limit_deg)
    safe_slope = np.divide(
        safe_count * 100.0,
        valid_count,
        out=np.full((height, width), np.nan, dtype=np.float32),
        where=valid_count >= 5,
    )
    safe_slope[~np.isfinite(dem_m)] = np.nan
    return relief.astype(np.float32), safe_slope.astype(np.float32)


def _requirement_grid(
    body: str,
    dem_m: np.ndarray,
    transform: Any,
    crs: Any,
    radius_km: float,
    earth_view_layer: np.ndarray | None = None,
) -> tuple[np.ndarray, str, str]:
    if body == "mars":
        # Approximation documented in the project's parameter guide; elevation is above areoid.
        density = 0.020 * np.exp(-((dem_m / 1000.0) / 11.1))
        return density.astype(np.float32), "descent_density_analog", "kg/m³"
    if earth_view_layer is not None:
        earth_view = np.asarray(earth_view_layer, dtype=np.float32).copy()
        earth_view[~np.isfinite(dem_m)] = np.nan
        return earth_view, "earth_view_analog", "%"
    info = _grid_info(crs, radius_km)
    lat, lon = _latitude_longitude_arrays(dem_m.shape, transform, info)
    lon = ((lon + 180.0) % 360.0) - 180.0
    visible = np.cos(np.radians(lat)) * np.cos(np.radians(lon)) > 0
    earth_view = np.where(visible, 100.0, 0.0).astype(np.float32)
    earth_view[~np.isfinite(dem_m)] = np.nan
    return earth_view, "earth_view_analog", "%"


def _latitude_vector(height: int, transform: Any, info: dict[str, Any]) -> np.ndarray:
    rows = np.arange(height, dtype=np.float64) + 0.5
    y = float(transform.f) + rows * float(transform.e)
    if info["kind"] == "geographic":
        return y
    params = info["parameters"]
    radius_m = info["radius_km"] * 1000
    y0 = float(params.get("y_0", 0))
    lat0 = float(params.get("lat_0", 0))
    return lat0 + np.degrees((y - y0) / radius_m)


def _latitude_longitude_arrays(
    shape: tuple[int, int], transform: Any, info: dict[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    height, width = shape
    latitudes = _latitude_vector(height, transform, info)[:, None]
    cols = np.arange(width, dtype=np.float64) + 0.5
    x = float(transform.c) + cols * float(transform.a)
    if info["kind"] == "geographic":
        return latitudes, x[None, :]
    params = info["parameters"]
    radius_m = info["radius_km"] * 1000
    x0 = float(params.get("x_0", 0))
    lon0 = float(params.get("lon_0", 0))
    scale = radius_m * math.cos(math.radians(info["lat_ts"]))
    longitudes = lon0 + np.degrees((x - x0) / scale)
    return latitudes, longitudes[None, :]


def _cell_coordinates(row: int, col: int, transform: Any, crs: Any, radius_km: float) -> tuple[float, float]:
    info = _grid_info(crs, radius_km)
    x = float(transform.c + (col + 0.5) * transform.a)
    y = float(transform.f + (row + 0.5) * transform.e)
    if info["kind"] == "geographic":
        lon, lat = x, y
    else:
        params = info["parameters"]
        coord_radius_m = info["radius_km"] * 1000
        lat = float(params.get("lat_0", 0)) + math.degrees(
            (y - float(params.get("y_0", 0))) / coord_radius_m
        )
        lon = float(params.get("lon_0", 0)) + math.degrees(
            (x - float(params.get("x_0", 0)))
            / (coord_radius_m * math.cos(math.radians(info["lat_ts"])))
        )
    return ((lon + 180.0) % 360.0) - 180.0, lat


def _cell_size_km(lat: float, transform: Any, crs: Any, radius_km: float) -> tuple[float, float]:
    info = _grid_info(crs, radius_km)
    if info["kind"] == "geographic":
        width = math.radians(abs(float(transform.a))) * radius_km * abs(
            math.cos(math.radians(lat))
        )
        height = math.radians(abs(float(transform.e))) * radius_km
        return width, height
    width = (
        abs(float(transform.a))
        * abs(math.cos(math.radians(lat)))
        / math.cos(math.radians(info["lat_ts"]))
        / 1000
    )
    height = abs(float(transform.e)) / 1000
    return width, height


def _haversine_km(
    lat1: float, lon1: float, lat2: float, lon2: float, radius_km: float
) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(((lon2 - lon1 + 180) % 360) - 180)
    term = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(
        d_lambda / 2
    ) ** 2
    return 2 * radius_km * math.asin(min(1.0, math.sqrt(term)))


def _json_number(value: Any) -> float | None:
    if value is None:
        return None
    number = float(value)
    return round(number, 5) if math.isfinite(number) else None


def analyze(
    *,
    body: str,
    manifest_path: Path,
    output_dir: Path,
    model_path: Path,
    selection_path: Path,
    grid_km: float | None = None,
    limit: int | None = None,
    minimum_separation_km: float | None = None,
) -> tuple[Path, Path, dict[str, Any]]:
    if body not in BODY_RADII_KM:
        raise AnalysisError("El cuerpo debe ser 'moon' o 'mars'.")
    manifest_path = manifest_path.resolve()
    manifest = load_json(manifest_path)
    if manifest.get("body") != body:
        raise AnalysisError(
            f"El manifiesto es para {manifest.get('body')!r}, pero se solicitó {body!r}."
        )
    model = load_json(model_path)
    selection = load_json(selection_path)
    profile = selection.get("bodies", {}).get(body)
    if not profile:
        raise AnalysisError(f"No existe el perfil de selección para {body}.")

    defaults = selection.get("candidate_defaults", {})
    grid_km = float(defaults.get("grid_km", 10) if grid_km is None else grid_km)
    limit = int(defaults.get("limit", 200) if limit is None else limit)
    alternative_limit = int(defaults.get("alternative_limit", 50))
    near_miss_margin = float(defaults.get("near_miss_margin_points", 5))
    minimum_separation_km = float(
        minimum_separation_km
        if minimum_separation_km is not None
        else defaults.get("minimum_separation_km", 30)
    )
    if (
        grid_km <= 0
        or limit <= 0
        or alternative_limit <= 0
        or near_miss_margin < 0
        or minimum_separation_km < 0
    ):
        raise AnalysisError(
            "grid-km, limit y alternative_limit deben ser positivos; "
            "el margen y la separación no pueden ser negativos."
        )

    dem_config = manifest.get("dem")
    if not isinstance(dem_config, dict):
        raise AnalysisError("El manifiesto necesita un objeto 'dem'.")
    radius_km = BODY_RADII_KM[body]
    dem_m, transform, crs, dem_source = _read_resampled_dem(
        dem_config, manifest_path, radius_km, grid_km
    )
    terrain = np.isfinite(dem_m)
    if not terrain.any():
        raise AnalysisError("El DEM no contiene píxeles válidos.")

    relief, safe_slope = _derive_terrain(
        dem_m,
        transform,
        crs,
        radius_km,
        float(selection.get("safe_slope_limit_degrees", 15)),
    )
    metric_values: dict[str, np.ndarray] = {
        "sunlight": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "albedo": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "relief": relief,
        "safeSlope": safe_slope,
        "craterFree": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "soilStability": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "ice": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "iceConfidence": np.full(dem_m.shape, np.nan, dtype=np.float32),
        "earthView": np.full(dem_m.shape, np.nan, dtype=np.float32),
    }
    layer_sources: dict[str, Any] = {}
    layers = manifest.get("layers", {})
    if not isinstance(layers, dict):
        raise AnalysisError("'layers' debe ser un objeto en el manifiesto.")
    for key in LAYER_KEYS:
        config = layers.get(key)
        if config is None:
            continue
        if not isinstance(config, dict):
            raise AnalysisError(f"La configuración de la capa {key} debe ser un objeto.")
        array, details = _read_metric_layer(
            key, config, manifest_path, dem_m.shape, transform, crs, radius_km
        )
        metric_values[key] = array
        layer_sources[key] = details

    configured_layers = set(layer_sources)
    if "ice" in layer_sources and "iceConfidence" not in layer_sources:
        confidence, confidence_details = _derive_ice_confidence(metric_values["ice"])
        metric_values["iceConfidence"] = confidence
        layer_sources["iceConfidence"] = confidence_details

    requirement_grid, requirement_key, requirement_units = _requirement_grid(
        body,
        dem_m,
        transform,
        crs,
        radius_km,
        metric_values["earthView"] if "earthView" in layer_sources else None,
    )
    requirement = model["bodies"][body]["requirement"]
    if requirement["column"] != requirement_key:
        raise AnalysisError(
            f"El requisito actual para {body} usa {requirement['column']}, pero el backend deriva {requirement_key}."
        )
    min_requirement = float(requirement["min"])
    eligible = terrain & np.isfinite(requirement_grid) & (requirement_grid >= min_requirement)
    if not eligible.any():
        raise AnalysisError(
            f"Ninguna celda cumple el requisito {requirement['short']} >= {min_requirement} {requirement_units}."
        )

    eligible_before_hard_filters = int(np.count_nonzero(eligible))
    base_eligible = eligible.copy()
    eligible, hard_filter_summary = _apply_hard_filters(
        eligible, metric_values, profile, configured_layers
    )

    parameter_model = {item["key"]: item for item in model["parameters"]}
    metric_scores: dict[str, np.ndarray] = {}
    for key, rule in profile.get("criteria", {}).items():
        if key not in parameter_model:
            raise AnalysisError(f"El criterio {key} no existe en parameter_model.json.")
        values = metric_values.get(key)
        if values is None:
            continue
        scale = float(rule.get("scale", 0))
        if scale <= 0:
            continue
        if rule.get("direction") not in {"higher", "lower"}:
            raise AnalysisError(f"Dirección inválida para el criterio {key}.")
        scores = 100.0 * values / scale
        if rule.get("direction") == "lower":
            scores = 100.0 - scores
        scores = np.clip(scores, 0, 100).astype(np.float32)
        scores[~np.isfinite(values)] = np.nan
        metric_scores[key] = scores

    weights = model["bodies"][body]["weights"]
    group_score_grids: dict[str, np.ndarray] = {}
    for group in model["groups"]:
        group_key = group["key"]
        parameter_keys = [
            key
            for key in metric_scores
            if parameter_model[key]["group"] == group_key
        ]
        if not parameter_keys:
            continue
        stack = np.stack([metric_scores[key] for key in parameter_keys])
        count = np.sum(np.isfinite(stack), axis=0)
        group_grid = np.divide(
            np.nansum(stack, axis=0),
            count,
            out=np.full(dem_m.shape, np.nan, dtype=np.float32),
            where=count > 0,
        )
        if np.isfinite(group_grid).any():
            group_score_grids[group_key] = group_grid

    present_group_weights = {
        key: float(value)
        for key, value in weights.items()
        if key in group_score_grids and value > 0
    }
    if not present_group_weights:
        raise AnalysisError("No hay parámetros con capas y reglas de puntuación disponibles.")
    weighted_sum = np.zeros(dem_m.shape, dtype=np.float32)
    weight_sum = np.zeros(dem_m.shape, dtype=np.float32)
    for key, weight in present_group_weights.items():
        grid = group_score_grids[key]
        valid = np.isfinite(grid)
        weighted_sum[valid] += grid[valid] * weight
        weight_sum[valid] += weight
    overall = np.divide(
        weighted_sum,
        weight_sum,
        out=np.full(dem_m.shape, np.nan, dtype=np.float32),
        where=weight_sum > 0,
    )
    confidence_derived_from_ice = (
        layer_sources.get("iceConfidence", {}).get("derived_from") == "ice"
    )
    near_miss_mask, ice_unassessed_mask = _ice_alternative_masks(
        base_eligible,
        metric_values,
        profile,
        configured_layers,
        confidence_derived_from_ice,
        near_miss_margin,
    )
    candidates = eligible & np.isfinite(overall)
    candidate_indices = np.flatnonzero(candidates)

    pool_size = min(candidate_indices.size, max(limit * 100, limit))
    if candidate_indices.size > pool_size:
        candidate_scores = overall.ravel()[candidate_indices]
        top = np.argpartition(candidate_scores, -pool_size)[-pool_size:]
        candidate_indices = candidate_indices[top]
    candidate_indices = candidate_indices[
        np.argsort(overall.ravel()[candidate_indices])[::-1]
    ]

    chosen: list[tuple[int, int, float, float, float]] = []
    spatially_suppressed: list[dict[str, Any]] = []
    spatially_suppressed_count = 0
    width = dem_m.shape[1]
    for flat_index in candidate_indices:
        row, col = divmod(int(flat_index), width)
        lon, lat = _cell_coordinates(row, col, transform, crs, radius_km)
        score = float(overall[row, col])
        distances = [
            (_haversine_km(lat, lon, old_lat, old_lon, radius_km), old_index)
            for old_index, (_, _, old_lat, old_lon, _) in enumerate(chosen, start=1)
        ]
        nearby = [item for item in distances if item[0] < minimum_separation_km]
        if nearby:
            spatially_suppressed_count += 1
            if len(spatially_suppressed) < alternative_limit:
                nearest_distance, nearest_index = min(nearby)
                spatially_suppressed.append(
                    {
                        "row": row,
                        "col": col,
                        "lat": lat,
                        "lon": lon,
                        "score": score,
                        "candidate_status": "passed_but_too_close",
                        "selection_detail": {
                            "nearest_selected_candidate": f"{body}-approx-{nearest_index:04d}",
                            "distance_to_nearest_selected_km": round(nearest_distance, 2),
                            "minimum_separation_km": minimum_separation_km,
                        },
                    }
                )
            continue
        chosen.append((row, col, lat, lon, score))
        if len(chosen) >= limit:
            break

    def select_spatially_separated(
        mask: np.ndarray,
        blocked_points: list[tuple[float, float]],
        candidate_status: str,
    ) -> list[dict[str, Any]]:
        indices = np.flatnonzero(mask & np.isfinite(overall))
        indices = indices[np.argsort(overall.ravel()[indices])[::-1]]
        selected: list[dict[str, Any]] = []
        separated_points = list(blocked_points)
        for flat_index in indices:
            row, col = divmod(int(flat_index), width)
            lon, lat = _cell_coordinates(row, col, transform, crs, radius_km)
            if minimum_separation_km > 0 and any(
                _haversine_km(lat, lon, other_lat, other_lon, radius_km)
                < minimum_separation_km
                for other_lat, other_lon in separated_points
            ):
                continue
            selected.append(
                {
                    "row": row,
                    "col": col,
                    "lat": lat,
                    "lon": lon,
                    "score": float(overall[row, col]),
                    "candidate_status": candidate_status,
                    "selection_detail": {},
                }
            )
            separated_points.append((lat, lon))
            if len(selected) >= alternative_limit:
                break
        return selected

    strict_points = [(lat, lon) for _, _, lat, lon, _ in chosen]
    near_miss_mask &= np.isfinite(overall)
    ice_unassessed_mask &= np.isfinite(overall)
    near_miss_specs = select_spatially_separated(
        near_miss_mask, strict_points, "near_miss"
    )
    unassessed_specs = select_spatially_separated(
        ice_unassessed_mask,
        strict_points + [(item["lat"], item["lon"]) for item in near_miss_specs],
        "ice_unassessed",
    )

    ice_rule = next(
        (item for item in profile.get("hard_filters", []) if item.get("key") == "ice"),
        None,
    )
    for item in near_miss_specs:
        value = float(metric_values["ice"][item["row"], item["col"]])
        threshold = float(ice_rule.get("threshold", 0)) if ice_rule else 0.0
        item["selection_detail"] = {
            "failed_filter": "ice",
            "value": round(value, 4),
            "threshold": threshold,
            "shortfall": round(threshold - value, 4),
            "near_miss_margin_points": near_miss_margin,
        }
    for item in unassessed_specs:
        item["selection_detail"] = {
            "unassessed_filter": "ice",
            "reason": (
                "no_ice_raster_coverage"
                if "ice" in configured_layers
                else "ice_layer_not_configured"
            ),
        }
    # A global cap keeps the alternatives file concise. Preserve this order so
    # measured passing sites and near misses are preferred over unassessed cells.
    alternative_specs = (
        spatially_suppressed + near_miss_specs + unassessed_specs
    )[:alternative_limit]

    all_parameters = [item["key"] for item in model["parameters"]]
    all_group_weight = sum(float(value) for value in weights.values())
    available_score_weight = sum(present_group_weights.values())
    score_coverage = 100 * available_score_weight / all_group_weight if all_group_weight else 0

    def build_feature(
        row: int,
        col: int,
        lat: float,
        lon: float,
        score: float,
        candidate_id: str,
        candidate_status: str,
        is_eligible: bool,
        selection_detail: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raw_metrics = {
            key: _json_number(values[row, col])
            for key, values in metric_values.items()
        }
        requirement_value = _json_number(requirement_grid[row, col])
        present_parameters = sum(raw_metrics.get(key) is not None for key in all_parameters)
        feature_groups = {
            key: _json_number(grid[row, col])
            for key, grid in group_score_grids.items()
        }
        feature_scores = {
            key: _json_number(grid[row, col]) if key in grid else None
            for key, grid in metric_scores.items()
        }
        feature_filters = {
            rule["key"]: _filter_result(
                _json_number(metric_values[rule["key"]][row, col]), rule
            )
            for rule in profile.get("hard_filters", [])
        }
        feature_filter_status = (
            "near_miss"
            if candidate_status == "near_miss"
            else "not_evaluated"
            if candidate_status == "ice_unassessed"
            else "partial"
            if any(item["status"] == "not_evaluated" for item in feature_filters.values())
            else "passed"
        )
        evaluated_filter_count = sum(
            item["status"] in {"passed", "failed"} for item in feature_filters.values()
        )
        filter_coverage = (
            100 * evaluated_filter_count / len(feature_filters) if feature_filters else 100
        )
        cell_width_km, cell_height_km = _cell_size_km(lat, transform, crs, radius_km)
        return {
            "type": "Feature",
            "id": candidate_id,
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "candidate_id": candidate_id,
                "candidate_status": candidate_status,
                "selection_detail": selection_detail or {},
                "body": body,
                "coordinate_system": "body geographic longitude/latitude in degrees; native DEM convention",
                "mission": profile["mission"],
                "footprint_km_at_equator": round(
                    float(selection.get("site_footprint_km", grid_km)), 2
                ),
                "grid_cell_width_km_at_latitude": round(cell_width_km, 3),
                "grid_cell_height_km": round(cell_height_km, 3),
                "polar_scale_warning": abs(lat) >= 75,
                "overall_score": round(score, 2),
                "score_is_partial": present_parameters < len(all_parameters),
                "scoring_coverage_percent": round(
                    100 * float(weight_sum[row, col]) / all_group_weight, 1
                )
                if all_group_weight
                else 0,
                "parameter_data_coverage_percent": round(
                    100 * present_parameters / len(all_parameters), 1
                ),
                "eligible": is_eligible,
                "filter_status": feature_filter_status,
                "hard_filter_coverage_percent": round(filter_coverage, 1),
                "hard_filters": feature_filters,
                "requirement": {
                    "key": requirement["key"],
                    "label": requirement["label"],
                    "value": requirement_value,
                    "unit": requirement_units,
                    "minimum": min_requirement,
                    "passed": requirement_value is not None
                    and requirement_value >= min_requirement,
                },
                "metrics": raw_metrics,
                "parameter_scores": feature_scores,
                "group_scores": feature_groups,
                "ice_confidence": raw_metrics.get("iceConfidence"),
                "ice_confidence_type": (
                    "local coverage and spatial coherence; not probability"
                    if layer_sources.get("iceConfidence", {}).get("derived_from") == "ice"
                    else "input confidence raster; consult its source metadata"
                    if raw_metrics.get("iceConfidence") is not None
                    else None
                ),
                "data_status": "partial" if present_parameters < len(all_parameters) else "available",
            },
        }

    features = [
        build_feature(
            row,
            col,
            lat,
            lon,
            score,
            f"{body}-approx-{index:04d}",
            "selected",
            True,
        )
        for index, (row, col, lat, lon, score) in enumerate(chosen, start=1)
    ]
    alternative_features = []
    alternative_status_counts: dict[str, int] = {}
    for item in alternative_specs:
        status = item["candidate_status"]
        alternative_status_counts[status] = alternative_status_counts.get(status, 0) + 1
        candidate_id = f"{body}-alt-{status}-{alternative_status_counts[status]:04d}"
        alternative_features.append(
            build_feature(
                item["row"],
                item["col"],
                item["lat"],
                item["lon"],
                item["score"],
                candidate_id,
                status,
                status == "passed_but_too_close",
                item.get("selection_detail"),
            )
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    geojson_path = output_dir / f"{body}_candidates.geojson"
    alternatives_geojson_path = output_dir / f"{body}_candidate_alternatives.geojson"
    manifest_out_path = output_dir / f"{body}_run_manifest.json"
    feature_collection = {"type": "FeatureCollection", "features": features}
    geojson_path.write_text(
        json.dumps(feature_collection, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    alternatives_feature_collection = {
        "type": "FeatureCollection",
        "features": alternative_features,
    }
    alternatives_geojson_path.write_text(
        json.dumps(
            alternatives_feature_collection,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    missing_layers = [key for key in LAYER_KEYS if key != "earthView" and key not in layer_sources]
    unavailable_filters = [
        item["key"]
        for item in hard_filter_summary
        if item["status"] in {"not_available", "missing_required", "configured_no_coverage"}
    ]
    requirement_method = (
        "capa de visibilidad promedio de la Tierra derivada de LOLA"
        if body == "moon" and "earthView" in layer_sources
        else profile.get("requirement_method", {}).get(requirement["column"])
    )
    run_info = {
        "body": body,
        "mission": profile["mission"],
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "result": geojson_path.name,
        "alternatives_result": alternatives_geojson_path.name,
        "alternatives_geojson": str(alternatives_geojson_path),
        "candidate_count": len(features),
        "alternative_candidate_count": len(alternative_features),
        "alternative_candidate_counts_by_status": alternative_status_counts,
        "alternative_limits": {
            "total_maximum": alternative_limit,
            "selection_priority": [
                "passed_but_too_close",
                "near_miss",
                "ice_unassessed",
            ],
            "near_miss_margin_points": near_miss_margin,
            "near_miss_cells_before_spacing": int(np.count_nonzero(near_miss_mask)),
            "ice_unassessed_cells_before_spacing": int(np.count_nonzero(ice_unassessed_mask)),
            "passed_candidates_suppressed_by_spacing_encountered": spatially_suppressed_count,
        },
        "eligible_cell_count_before_hard_filters": eligible_before_hard_filters,
        "eligible_cell_count_before_spatial_separation": int(np.count_nonzero(candidates)),
        "grid_km_at_equator": round(grid_km, 3),
        "coordinate_crs": str(crs),
        "coordinate_convention": "Native geographic convention recorded by the DEM; verify its PDS/USGS label before cross-source overlays.",
        "minimum_separation_km": minimum_separation_km,
        "site_footprint_km": selection.get("site_footprint_km"),
        "safe_slope_limit_degrees": selection.get("safe_slope_limit_degrees"),
        "requirement": {
            "key": requirement["key"],
            "description": requirement["label"],
            "minimum": min_requirement,
            "unit": requirement_units,
            "method": requirement_method,
        },
        "hard_filter_summary": hard_filter_summary,
        "filters_not_evaluated": unavailable_filters,
        "model_weights": weights,
        "scoring_coverage_percent": round(
            float(
                np.mean(
                    [100 * float(weight_sum[row, col]) / all_group_weight for row, col, *_ in chosen]
                )
            ),
            1,
        )
        if all_group_weight and chosen
        else round(score_coverage, 1),
        "missing_optional_layers": missing_layers,
        "scored_parameters": sorted(
            key for key, grid in metric_scores.items() if np.isfinite(grid).any()
        ),
        "not_scored": profile.get("not_scored", {}),
        "ice_confidence_interpretation": (
            layer_sources.get("iceConfidence", {}).get("method")
            or "Confidence raster supplied as input; interpret using its source metadata."
            if "iceConfidence" in layer_sources
            else None
        ),
        "sources": {"dem": dem_source, "layers": layer_sources},
        "heuristic_criteria": profile.get("criteria", {}),
        "limitations": [
            "Los umbrales son heurísticos configurables para exploración; no son límites certificados de misión.",
            "Resultado exploratorio aproximado; no es recomendación de aterrizaje ni certificación de seguridad.",
            "La pendiente y el desnivel se derivan del DEM remuestreado a la resolución de análisis.",
            "Los filtros de capas opcionales solo se evalúan si se proporciona una capa; revisar filters_not_evaluated.",
            "Cráteres/rocas y estabilidad del suelo requieren capas de entrada documentadas.",
            "La similitud con la Tierra y el CSV planetary_candidates.csv no participan en este proceso.",
            "La puntuación se calcula solo con los parámetros disponibles; consultar data_coverage y scoring_coverage.",
            "La cuadrícula geográfica se estrecha hacia los polos; revisar la advertencia polar y usar productos polares para análisis de detalle.",
        ],
    }
    manifest_out_path.write_text(
        json.dumps(run_info, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return geojson_path, manifest_out_path, run_info
