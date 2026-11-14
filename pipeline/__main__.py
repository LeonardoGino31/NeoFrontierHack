"""Línea de comandos del pipeline. Se ejecuta desde la raíz del repo:

    python -m pipeline fetch            # descarga y calcula -> public/data/site_values.json
    python -m pipeline fetch --sites jezero,shackleton --no-appeears
    python -m pipeline apply            # copia los valores medidos al CSV de la app
"""

import argparse
import json
from pathlib import Path

from .collect import collect
from .output import apply_to_csv, write_values
from .sites import load_sites

CONFIG = Path(__file__).with_name("config.json")


def main() -> None:
    """Lee los argumentos y ejecuta `fetch` o `apply`."""
    parser = argparse.ArgumentParser(prog="python -m pipeline", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch = sub.add_parser("fetch", help="descarga las ventanas y calcula las métricas")
    fetch.add_argument("--sites", help="ids separados por comas (por defecto, todos)")
    fetch.add_argument("--no-appeears", action="store_true", help="omite MODIS (no requiere cuenta de Earthdata)")
    sub.add_parser("apply", help="copia site_values.json al CSV de la app")
    args = parser.parse_args()

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    output, csv_path, cache_dir = Path(cfg["output"]), Path(cfg["sitesCsv"]), Path(cfg["cacheDir"])

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
