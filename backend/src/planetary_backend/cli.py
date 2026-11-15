"""Command-line interface for approximate Moon/Mars site screening."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .engine import AnalysisError, analyze
from .sources import download_dem, load_source_catalog


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent
DEFAULT_MODEL = PROJECT_ROOT / "public" / "data" / "parameter_model.json"
DEFAULT_SELECTION = BACKEND_ROOT / "config" / "site_selection.json"
DEFAULT_CATALOG = BACKEND_ROOT / "config" / "source_catalog.json"
DEFAULT_OUTPUT = BACKEND_ROOT / "data" / "outputs"
DEFAULT_RAW = BACKEND_ROOT / "data" / "raw"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="planetary-backend",
        description="Filtra y prioriza ubicaciones aproximadas de Luna o Marte a partir de DEM y capas científicas.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_parser = subparsers.add_parser("analyze", help="Genera candidatos en GeoJSON.")
    analyze_parser.add_argument("--body", choices=("moon", "mars"), required=True)
    analyze_parser.add_argument(
        "--manifest",
        type=Path,
        help="Manifiesto de datos. Por defecto usa backend/examples/<body>_manifest.json.",
    )
    analyze_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    analyze_parser.add_argument("--parameter-model", type=Path, default=DEFAULT_MODEL)
    analyze_parser.add_argument("--selection-profile", type=Path, default=DEFAULT_SELECTION)
    analyze_parser.add_argument("--grid-km", type=float, help="Tamaño aproximado de celda en el ecuador.")
    analyze_parser.add_argument("--limit", type=int, help="Máximo de puntos candidatos a exportar.")
    analyze_parser.add_argument(
        "--minimum-separation-km", type=float, help="Separación mínima entre ubicaciones exportadas."
    )

    download_parser = subparsers.add_parser(
        "download-dem", help="Descarga el DEM global de referencia (varios GB)."
    )
    download_parser.add_argument("--body", choices=("moon", "mars"), required=True)
    download_parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    download_parser.add_argument("--output", type=Path, default=DEFAULT_RAW)
    download_parser.add_argument("--accept-large-download", action="store_true")

    sources_parser = subparsers.add_parser("sources", help="Muestra las fuentes de datos configuradas.")
    sources_parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "sources":
            catalog = load_source_catalog(args.catalog)
            print(json.dumps(catalog, ensure_ascii=False, indent=2))
            return 0
        if args.command == "download-dem":
            path = download_dem(
                args.body, args.catalog, args.output, args.accept_large_download
            )
            print(f"DEM disponible: {path}")
            return 0

        manifest = args.manifest or BACKEND_ROOT / "examples" / f"{args.body}_manifest.json"
        geojson_path, run_manifest_path, info = analyze(
            body=args.body,
            manifest_path=manifest,
            output_dir=args.output,
            model_path=args.parameter_model,
            selection_path=args.selection_profile,
            grid_km=args.grid_km,
            limit=args.limit,
            minimum_separation_km=args.minimum_separation_km,
        )
        print(f"Candidatos exportados: {info['candidate_count']}")
        print(f"GeoJSON: {geojson_path}")
        print(f"Manifiesto: {run_manifest_path}")
        print(f"Cobertura de grupos puntuados: {info['scoring_coverage_percent']:.1f}%")
        return 0
    except AnalysisError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
