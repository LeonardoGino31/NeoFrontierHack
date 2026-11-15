"""Catalog and explicit large-file downloader for baseline planetary DEMs."""

from __future__ import annotations

import json
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
