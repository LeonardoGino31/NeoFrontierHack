"""Catalog and explicit large-file downloader for baseline planetary DEMs."""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from .engine import AnalysisError, load_json


def load_source_catalog(path: Path) -> dict[str, Any]:
    return load_json(path)


def download_dem(
    body: str,
    catalog_path: Path,
    output_dir: Path,
    accept_large_download: bool,
) -> Path:
    catalog = load_source_catalog(catalog_path)
    source = catalog.get("bodies", {}).get(body, {}).get("dem")
    if not source:
        raise AnalysisError(f"No existe una fuente DEM configurada para {body}.")
    if not accept_large_download:
        raise AnalysisError(
            "El DEM global ocupa mucho espacio. Repite el comando con --accept-large-download para iniciar la descarga."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{body}_dem.tif"
    if target.is_file() and target.stat().st_size > 0:
        print(f"El DEM ya existe: {target}")
        return target
    temporary = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(
        source["url"], headers={"User-Agent": "NeoFrontierHack-planetary-backend/0.1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            total = int(response.headers.get("Content-Length", 0) or 0)
            copied = 0
            while block := response.read(8 * 1024 * 1024):
                output.write(block)
                copied += len(block)
                if total:
                    print(f"\rDescargado {copied / total:.1%} ({copied / 1_000_000:.0f} MB)", end="", flush=True)
                else:
                    print(f"\rDescargado {copied / 1_000_000:.0f} MB", end="", flush=True)
        print()
        temporary.replace(target)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise AnalysisError(f"Falló la descarga de {source['title']}: {exc}") from exc

    size_gb = target.stat().st_size / (1024**3)
    print(f"Guardado en {target} ({size_gb:.2f} GiB).")
    return target


def download_layer(
    body: str,
    layer: str,
    region: str,
    catalog_path: Path,
    output_dir: Path,
    manifest_path: Path,
    accept_download: bool,
) -> list[Path]:
    """Download a catalogued science raster and register it in a manifest."""
    catalog = load_source_catalog(catalog_path)
    layer_source = (
        catalog.get("bodies", {}).get(body, {}).get("downloadable_layers", {}).get(layer)
    )
    if not layer_source:
        raise AnalysisError(f"No existe una descarga directa configurada para {body}/{layer}.")
    regions = layer_source.get("regions", {})
    selected_regions = list(regions) if region == "both" else [region]
    if not selected_regions or any(name not in regions for name in selected_regions):
        raise AnalysisError(
            f"La región debe ser una de: {', '.join(regions)}" + (", both." if len(regions) > 1 else ".")
        )
    if not accept_download:
        raise AnalysisError(
            "Las capas polares pueden ocupar decenas o cientos de MB. "
            "Repite con --accept-download para iniciar la descarga."
        )

    manifest_path = manifest_path.resolve()
    manifest = load_json(manifest_path)
    if manifest.get("body") != body:
        raise AnalysisError(
            f"El manifiesto es para {manifest.get('body')!r}, pero se solicitó {body!r}."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    registered_sources = []
    downloaded = []
    for region_name in selected_regions:
        source = regions[region_name]
        target = output_dir / f"{body}_{layer}_{region_name}.tif"
        if target.is_file() and target.stat().st_size > 0:
            print(f"La capa ya existe: {target}")
        else:
            temporary = target.with_suffix(target.suffix + ".part")
            request = urllib.request.Request(
                source["url"],
                headers={"User-Agent": "NeoFrontierHack-planetary-backend/0.1"},
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
                    total = int(response.headers.get("Content-Length", 0) or 0)
                    copied = 0
                    while block := response.read(8 * 1024 * 1024):
                        output.write(block)
                        copied += len(block)
                        if total:
                            print(
                                f"\r{region_name}: {copied / total:.1%} "
                                f"({copied / 1_000_000:.0f} MB)",
                                end="",
                                flush=True,
                            )
                        else:
                            print(
                                f"\r{region_name}: {copied / 1_000_000:.0f} MB",
                                end="",
                                flush=True,
                            )
                print()
                temporary.replace(target)
            except Exception as exc:
                temporary.unlink(missing_ok=True)
                raise AnalysisError(f"Falló la descarga de {source['source_id']}: {exc}") from exc
        downloaded.append(target)
        registered_sources.append(
            {
                "path": os.path.relpath(target.resolve(), manifest_path.parent),
                "band": 1,
                "scale": float(layer_source.get("scale", 1)),
                "offset": 0,
                "units": layer_source.get("units"),
                "source_id": source["source_id"],
                "source_url": source.get("source_page", layer_source["source_page"]),
                "data_url": source["url"],
                "coverage": source.get("coverage"),
                "native_resolution_m": source.get("native_resolution_m"),
            }
        )

    layers = manifest.setdefault("layers", {})
    current = layers.get(layer, {})
    if not isinstance(current, dict):
        raise AnalysisError(f"La configuración de {layer} en el manifiesto debe ser un objeto.")
    existing_sources = current.get("sources")
    if existing_sources is None:
        existing_sources = [current] if current.get("path") else []
    if not isinstance(existing_sources, list):
        raise AnalysisError(f"La lista de fuentes de {layer} debe ser una lista.")
    unkeyed_sources = [
        item
        for item in existing_sources
        if isinstance(item, dict) and not item.get("source_id")
    ]
    by_source_id = {
        item.get("source_id"): item
        for item in existing_sources
        if isinstance(item, dict) and item.get("source_id")
    }
    by_source_id.update({item["source_id"]: item for item in registered_sources})
    layers[layer] = {
        "units": layer_source.get("units"),
        "normalization": layer_source.get("normalization"),
        "sources": unkeyed_sources + list(by_source_id.values()),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Manifiesto actualizado: {manifest_path}")
    return downloaded
