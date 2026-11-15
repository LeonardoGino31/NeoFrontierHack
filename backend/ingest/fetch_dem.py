"""Recorta una ventana de Copernicus GLO-30 (30 m) alrededor de cada punto de la Tierra del CSV.

Los tiles son COG públicos en AWS (sin login): rasterio solo pide los bloques de la ventana,
así que se descargan unos pocos MB por sitio, no el tile completo (~10-40 MB).

Uso (desde la raíz del repo):
    backend/.venv/bin/python backend/ingest/fetch_dem.py --dry-run     # solo muestra tiles, no descarga
    backend/.venv/bin/python backend/ingest/fetch_dem.py               # descarga a data/raw/dem/
    backend/.venv/bin/python backend/ingest/fetch_dem.py --site hanksville --size-km 20
"""
import argparse
import csv
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "public" / "data" / "planetary_candidates.csv"
OUT_DIR = ROOT / "data" / "raw" / "dem"
BASE = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_url(lat_floor: int, lon_floor: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    name = f"Copernicus_DSM_COG_10_{ns}{abs(lat_floor):02d}_00_{ew}{abs(lon_floor):03d}_00_DEM"
    return f"{BASE}/{name}/{name}.tif"


def bbox(lat: float, lon: float, size_km: float):
    """(oeste, sur, este, norte) de un cuadrado de `size_km` centrado en el punto."""
    half = size_km / 2
    dlat = half / 111.32
    dlon = half / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def tiles_for(b):
    west, south, east, north = b
    return [
        (la, lo)
        for la in range(math.floor(south), math.floor(north) + 1)
        for lo in range(math.floor(west), math.floor(east) + 1)
    ]


def earth_sites(only=None):
    with open(CSV_PATH, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if only and r["earth_site_id"] != only:
                continue
            yield r["earth_site_id"], float(r["earth_latitude"]), float(r["earth_longitude"])


def fetch(site_id, b, out_path):
    import rasterio
    from rasterio.merge import merge

    urls = [tile_url(la, lo) for la, lo in tiles_for(b)]
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        datasets = [rasterio.open(u) for u in urls]
        try:
            data, transform = merge(datasets, bounds=b)
            profile = datasets[0].profile
            nodata = datasets[0].nodata
        finally:
            for d in datasets:
                d.close()
    profile.update(
        driver="GTiff", height=data.shape[1], width=data.shape[2], transform=transform,
        tiled=False, blockxsize=None, blockysize=None, compress="deflate",
    )
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(data)
    valid = (data != nodata).sum() if nodata is not None else data.size
    return data.shape, valid / data.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", help="solo este earth_site_id")
    ap.add_argument("--size-km", type=float, default=20.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True) if not args.dry_run else None
    sites = list(earth_sites(args.site))
    if not sites:
        sys.exit(f"Sitio no encontrado: {args.site}")

    for site_id, lat, lon in sites:
        b = bbox(lat, lon, args.size_km)
        tiles = tiles_for(b)
        if args.dry_run:
            print(f"{site_id:12} bbox={tuple(round(x, 3) for x in b)} tiles={len(tiles)}")
            for la, lo in tiles:
                print(f"   {tile_url(la, lo)}")
            continue
        try:
            shape, valid = fetch(site_id, b, OUT_DIR / f"{site_id}.tif")
            print(f"{site_id:12} ok  {shape[2]}x{shape[1]} px  datos válidos: {valid:.0%}")
        except Exception as exc:  # un sitio fallido no debe detener a los demás
            print(f"{site_id:12} ERROR {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
