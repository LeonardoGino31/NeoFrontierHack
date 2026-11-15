"""Descarga y guarda las imágenes reales de cada pareja del CSV (NASA Trek y NASA GIBS).

La app muestra, para cada pareja Tierra–análogo, un recorte de imagen y otro de relieve de
cada lado. Este script los genera a partir de `public/data/planetary_candidates.csv` y los deja
en `public/trek/sites/`, para que la demo no dependa de que Trek o GIBS respondan ese día.

  Marte  : Viking MDIM 2.1 (imagen) y MGS MOLA (relieve)    — Mars Trek
  Luna   : LRO WAC (imagen) y LRO LOLA (relieve)            — Moon Trek
  Tierra : Landsat 31 m (imagen; Blue Marble NG en la Antártida) y ASTER GDEM (relieve) — NASA GIBS

Nombres de archivo (los que espera la app):
  análogo → <candidate_id>_visible.jpg / <candidate_id>_relief.jpg
  Tierra  → earth_<earth_site_id>_visible.jpg / earth_<earth_site_id>_relief.jpg

Cada recorte se proyecta en azimutal equidistante centrado en el sitio, con el norte arriba:
así no sale estirado ni cerca de los polos. Los sitios polares solo tienen relieve.

Requisitos: python3 con numpy y Pillow.
Uso (desde la raíz del repo):
  python3 scripts/fetch_pair_images.py              # solo las imágenes que faltan
  python3 scripts/fetch_pair_images.py --force      # vuelve a generarlas todas
  python3 scripts/fetch_pair_images.py --ids tierra-mars-alt-passed_but_too_close-0001
Las teselas crudas se guardan en `.trek-cache/` (ignorado por git), así que repetirlo es rápido.
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "public/data/planetary_candidates.csv"
OUT_DIR = ROOT / "public/trek/sites"
CACHE = ROOT / ".trek-cache"

SITE_PX = 768
TREK = "https://trek.nasa.gov/tiles"
GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"

# Rejillas: trek = teselas de 256 px, nivel 0 de 2×1 (180° por tesela);
#           gibs = teselas de 512 px, nivel 0 de 2×1 (288° por tesela).
LAYERS = {
    ("mars", "visible"): ("trek", f"{TREK}/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm", "jpg", 7),
    ("mars", "relief"): ("trek", f"{TREK}/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm", "jpg", 7),
    ("moon", "visible"): ("trek", f"{TREK}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm", "jpg", 8),
    ("moon", "relief"): ("trek", f"{TREK}/Moon/EQ/LRO_LOLA_Shade_Global_256ppd_v06/1.0.0/default/default028mm", "png", 6),
    # Landsat (31 m) da detalle a 30 km; Blue Marble (500 m) solo respalda donde Landsat no llega (Antártida)
    ("earth", "visible"): ("gibs", f"{GIBS}/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/31.25m", "jpg", 11),
    ("earth", "visible-fallback"): ("gibs", f"{GIBS}/BlueMarble_NextGeneration/default/default/500m", "jpeg", 7),
    ("earth", "relief"): ("gibs", f"{GIBS}/ASTER_GDEM_Color_Shaded_Relief/default/default/31.25m", "jpeg", 11),
}
COLOR_SHADED = {("mars", "relief"), ("earth", "relief")}
RADIUS_KM = {"earth": 6371.0, "mars": 3389.5, "moon": 1737.4}
GRID = {"trek": (256, 180.0), "gibs": (512, 288.0)}  # (px por tesela, grados del nivel 0 por tesela)


def fetch_tile(url: str, dest: Path) -> Image.Image | None:
    """Una tesela, de la caché o descargada. Un 404 es zona sin cobertura (se devuelve None)."""
    missing = dest.with_suffix(dest.suffix + ".missing")
    if dest.exists():
        return Image.open(dest).convert("RGBA")
    if missing.exists():
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": "neofrontier-images"}), timeout=60) as r:
                data = r.read()
            dest.write_bytes(data)
            return Image.open(io.BytesIO(data)).convert("RGBA")
        except HTTPError as e:
            if e.code in (400, 404):
                missing.touch()
                return None
        except (URLError, TimeoutError, OSError):
            pass
    raise RuntimeError(f"No se pudo descargar {url}")


def stitch(layer: tuple, z: int, rows: range, cols: range) -> np.ndarray:
    """Une un bloque de teselas en una imagen RGBA; las que faltan quedan transparentes."""
    grid, base, ext, _ = layer
    tile, _deg0 = GRID[grid]
    ncols = 2 ** (z + 1)
    slug = "".join(ch if ch.isalnum() or ch in "._/-" else "_" for ch in base.removeprefix("https://"))
    jobs = [(r, c) for r in rows for c in cols]

    def one(rc):
        r, c = rc
        cc = c % ncols if grid == "trek" else c  # Trek da la vuelta en longitud; GIBS no
        return fetch_tile(f"{base}/{z}/{r}/{cc}.{ext}", CACHE / slug / str(z) / str(r) / f"{cc}.{ext}")

    with ThreadPoolExecutor(8) as pool:
        tiles = dict(zip(jobs, pool.map(one, jobs)))
    canvas = np.zeros((len(rows) * tile, len(cols) * tile, 4), dtype=np.uint8)
    for (r, c), img in tiles.items():
        if img is None:
            continue
        arr = np.asarray(img.resize((tile, tile)) if img.size != (tile, tile) else img)
        canvas[(r - rows.start) * tile:(r - rows.start + 1) * tile,
               (c - cols.start) * tile:(c - cols.start + 1) * tile] = arr
    return canvas


def azimuthal_grid(lat0: float, lon0: float, km: float, radius: float, size: int):
    """Latitud y longitud de cada píxel de un recorte cuadrado azimutal equidistante (norte arriba)."""
    half = km / 2 / radius
    t = np.linspace(-half, half, size)
    x, y = np.meshgrid(t, -t)  # y crece hacia el norte
    phi0, lam0 = math.radians(lat0), math.radians(lon0)
    rho = np.hypot(x, y)
    c = rho
    rho_safe = np.where(rho == 0, 1, rho)
    lat = np.arcsin(np.clip(np.cos(c) * math.sin(phi0) + y * np.sin(c) * math.cos(phi0) / rho_safe, -1, 1))
    lon = lam0 + np.arctan2(x * np.sin(c),
                            rho_safe * math.cos(phi0) * np.cos(c) - y * math.sin(phi0) * np.sin(c))
    lat = np.where(rho == 0, phi0, lat)
    lon = np.where(rho == 0, lam0, lon)
    return np.degrees(lat), (np.degrees(lon) + 180) % 360 - 180


def render_patch(body: str, kind: str, lat0: float, lon0: float, km: float, flat: bool = False) -> Image.Image | None:
    """Recorte de `km` de ancho centrado en el sitio. None si la capa no cubre el lugar."""
    layer = LAYERS[(body, kind)]
    return _render(layer, body, kind, lat0, lon0, km, flat)


def _render(layer: tuple, body: str, kind: str, lat0: float, lon0: float, km: float, flat: bool) -> Image.Image | None:
    grid, _base, _ext, zmax = layer
    tile, deg0 = GRID[grid]
    lat, lon = azimuthal_grid(lat0, lon0, km, RADIUS_KM[body], SITE_PX)

    # Zoom: el menor que da ≥ SITE_PX píxeles a lo ancho, sin pasar del máximo de la capa
    dlat = km / (2 * math.pi * RADIUS_KM[body] / 360)
    z = next((z for z in range(zmax) if dlat * tile / (deg0 / 2 ** z) >= SITE_PX), zmax)
    ppd = tile / (deg0 / 2 ** z)

    # Ventana de teselas que cubre el recorte; si toca un polo, abarca todas las longitudes
    lat_min, lat_max = float(lat.min()), float(lat.max())
    wide = abs(lat0) + dlat * 1.5 >= 89.9
    dl = (lon - lon0 + 180) % 360 - 180
    lon_lo, lon_hi = (lon0 - 180, lon0 + 180) if wide else (lon0 + float(dl.min()), lon0 + float(dl.max()))
    r0 = max(0, int((90 - lat_max) * ppd // tile))
    r1 = min(int((90 - lat_min) * ppd // tile), 2 ** z - 1)
    c0, c1 = int((lon_lo + 180) * ppd // tile), int((lon_hi + 180) * ppd // tile)
    canvas = stitch(layer, z, range(r0, r1 + 1), range(c0, c1 + 1))

    # Muestreo bilineal en el lienzo (la longitud se desenvuelve respecto a lon_lo)
    px = ((lon - lon_lo) % 360 + lon_lo + 180) * ppd - c0 * tile
    py = (90 - lat) * ppd - r0 * tile
    h, w = canvas.shape[:2]
    px, py = np.clip(px - 0.5, 0, w - 1.001), np.clip(py - 0.5, 0, h - 1.001)
    x0, y0 = px.astype(int), py.astype(int)
    fx, fy = (px - x0)[..., None], (py - y0)[..., None]
    c = canvas.astype(np.float32)
    out = (c[y0, x0] * (1 - fx) * (1 - fy) + c[y0, x0 + 1] * fx * (1 - fy)
           + c[y0 + 1, x0] * (1 - fx) * fy + c[y0 + 1, x0 + 1] * fx * fy)

    alpha = out[..., 3] / 255
    if (alpha > 0.5).mean() < 0.5 or out[..., :3].mean() < 6:  # sin cobertura, o tesela en blanco  # la capa no cubre este sitio (p. ej. ASTER pasa de ±83°)
        return None
    rgb = out[..., :3] * alpha[..., None]  # lo transparente queda negro
    flat = flat or (body, kind) in COLOR_SHADED  # el relieve ya viene coloreado: estirarlo solo amplifica el ruido
    if not flat:  # estiramiento de contraste: solo para verlo mejor, no se usa para medir
        valid = alpha > 0.5
        for ch in range(3):
            lo, hi = np.percentile(rgb[..., ch][valid], (0.5, 99.5))
            if hi > lo:
                rgb[..., ch] = np.clip((rgb[..., ch] - lo) / (hi - lo) * 255, 0, 255)
    return Image.fromarray(rgb.astype(np.uint8))


def render_with_fallback(body: str, kind: str, lat0: float, lon0: float, km: float) -> Image.Image | None:
    """Como `render_patch`, pero si la capa principal no cubre el sitio prueba la de respaldo."""
    img = render_patch(body, kind, lat0, lon0, km)
    if img is None and (body, f"{kind}-fallback") in LAYERS:
        img = _render(LAYERS[(body, f"{kind}-fallback")], body, kind, lat0, lon0, km, False)
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="regenera aunque el archivo ya exista")
    ap.add_argument("--ids", help="solo estos earth_site_id o candidate_id (separados por coma)")
    args = ap.parse_args()
    wanted = set(args.ids.split(",")) if args.ids else None

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = [r for r in csv.DictReader(CSV_PATH.open(encoding="utf-8")) if r["record_type"] == "pair"]
    made = skipped = failed = 0
    for row in rows:
        body, km = row["body"], float(row["footprint_km"])
        polar = row["analog_polar"].strip().lower() == "true"
        jobs = [
            (f"earth_{row['earth_site_id']}", "earth", float(row["earth_latitude"]), float(row["earth_longitude"]), ("visible", "relief")),
            (row["candidate_id"], body, float(row["analog_latitude"]), float(row["analog_longitude"]),
             ("relief",) if polar else ("visible", "relief")),  # cerca del polo la imagen visible está en sombra
        ]
        for name, b, lat, lon, kinds in jobs:
            if wanted and row["earth_site_id"] not in wanted and row["candidate_id"] not in wanted:
                continue
            for kind in kinds:
                dest = OUT_DIR / f"{name}_{kind}.jpg"
                if dest.exists() and not args.force:
                    skipped += 1
                    continue
                try:
                    img = render_with_fallback(b, kind, lat, lon, km)
                except Exception as e:  # una tesela caída no debe frenar las demás
                    print(f"✗ {dest.name}: {e}", file=sys.stderr)
                    failed += 1
                    continue
                if img is None:
                    print(f"– {dest.name}: la capa no cubre ({lat}, {lon})")
                    failed += 1
                    continue
                img.save(dest, quality=85)
                print(f"✓ {dest.name}")
                made += 1
    print(f"\nListo: {made} generadas, {skipped} ya existían, {failed} sin imagen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
