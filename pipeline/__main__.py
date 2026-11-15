"""Línea de comandos del pipeline. Se ejecuta desde la raíz del repo:

    python -m pipeline fetch            # descarga y calcula -> public/data/site_values.json
    python -m pipeline fetch --sites jezero,shackleton --no-appeears
    python -m pipeline apply            # copia los valores medidos al CSV de la app
    python -m pipeline earth-topo       # topografía global de la Tierra (horas; reanudable)
    python -m pipeline earth-topo --bbox -70,-25,-66,-21   # solo una región (oeste,sur,este,norte)
    python -m pipeline earth-modis      # hielo, luz solar y suelo globales (requiere Earthdata)
    python -m pipeline targets          # objetivos: CSV + oficiales + propuestas propias
    python -m pipeline search           # candidatos en la Tierra -> public/data/earth_candidates.json
"""

import argparse
import json
from pathlib import Path

from .collect import collect
from .earth import topography
from .earth.modis import run as modis_run
from .output import apply_to_csv, write_values
from .search import run as search_run
from .sites import load_sites
from .targets import build as build_targets

HERE = Path(__file__).parent
CONFIG = HERE / "config.json"


def main() -> None:
    """Lee los argumentos y ejecuta el comando pedido."""
    parser = argparse.ArgumentParser(prog="python -m pipeline", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch = sub.add_parser("fetch", help="descarga las ventanas y calcula las métricas")
    fetch.add_argument("--sites", help="ids separados por comas (por defecto, todos)")
    fetch.add_argument("--no-appeears", action="store_true", help="omite MODIS (no requiere cuenta de Earthdata)")
    sub.add_parser("apply", help="copia site_values.json al CSV de la app")
    topo = sub.add_parser("earth-topo", help="topografía de la Tierra en celdas de 0.05° (COP-DEM 90 m)")
    topo.add_argument("--bbox", help="oeste,sur,este,norte en grados (por defecto, todo el planeta)")
    modis = sub.add_parser("earth-modis", help="capas globales de MODIS (requiere cuenta de Earthdata)")
    modis.add_argument("--year", type=int, default=2024)
    sub.add_parser("targets", help="arma pipeline/targets.json")
    search = sub.add_parser("search", help="busca análogos en la Tierra para cada objetivo")
    search.add_argument("--targets", help="ids separados por comas (por defecto, todos)")
    search.add_argument("--top", type=int, default=25, help="candidatos por objetivo")
    args = parser.parse_args()

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    output, csv_path, cache_dir = Path(cfg["output"]), Path(cfg["sitesCsv"]), Path(cfg["cacheDir"])

    if args.command == "earth-topo":
        bbox = tuple(float(v) for v in args.bbox.split(",")) if args.bbox else None
        print(f"Malla escrita en {topography.run(cfg, cache_dir, bbox)}")
        return

    if args.command == "earth-modis":
        print(f"Malla escrita en {modis_run(cfg, cache_dir, args.year)}")
        return

    model_path = Path("public/data/parameter_model.json")
    if args.command == "targets":
        model = json.loads(model_path.read_text(encoding="utf-8"))
        build_targets(cfg, cache_dir, model, HERE / "targets_official.json", HERE / "targets.json")
        return
    if args.command == "search":
        only = set(args.targets.split(",")) if args.targets else None
        out = search_run(cfg, cache_dir, HERE / "targets.json", model_path,
                         Path("public/data/earth_candidates.json"), only, args.top)
        print(f"Escrito {out}")
        return

    if args.command == "apply":
        print(f"{apply_to_csv(output, csv_path)} celdas actualizadas en {csv_path}")
        return

    sites = load_sites(csv_path)
    if args.sites:
        wanted = set(args.sites.split(","))
        sites = [s for s in sites if s.id in wanted]
    values = collect(sites, cfg, cache_dir, use_appeears=not args.no_appeears)
    if args.sites and output.exists():
        # Una ejecución parcial actualiza esos sitios sin borrar los demás
        values = {**json.loads(output.read_text(encoding="utf-8"))["sites"], **values}
    write_values(output, values, cfg)
    print(f"Escrito {output} ({len(values)} sitios)")


if __name__ == "__main__":
    main()
