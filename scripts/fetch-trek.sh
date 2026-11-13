#!/usr/bin/env bash
# Descarga capas de NASA Solar System Treks (Marte, Luna) y NASA GIBS (Tierra) y las deja
# listas en public/.
#
# Se ejecuta una sola vez (no en cada build): la app sirve los archivos locales para que la
# demo no dependa de que Trek o GIBS respondan ese día.
#
# Requisitos: bash, curl, awk, xargs, ImageMagick 7 (`magick`) y python3 con numpy + Pillow.
# Uso:        ./scripts/fetch-trek.sh            (desde la raíz del repo)
#             FORCE=1 ./scripts/fetch-trek.sh    (vuelve a generar todo)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_TEX="$ROOT/public/textures/trek"
OUT_SITES="$ROOT/public/trek/sites"
CACHE="${TREK_CACHE:-$ROOT/.trek-cache}"   # tiles crudas; está en .gitignore
JOBS="${JOBS:-8}"
SITE_PX=768

TREK="https://trek.nasa.gov/tiles"
GIBS="https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"

# Capas: "rejilla|URL base (hasta antes de {z})|extensión|zoom máximo".
# Rejillas: trek = tiles de 256 px, nivel 0 de 2×1 (180° por tile);
#           gibs = tiles de 512 px, nivel 0 de 2×1 (288° por tile, sobra a la derecha).
MOON_WAC="trek|$TREK/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm|jpg|8"
MOON_LOLA="trek|$TREK/Moon/EQ/LRO_LOLA_Shade_Global_256ppd_v06/1.0.0/default/default028mm|png|6"
MOON_PSR="trek|$TREK/Moon/EQ/LRO_LOLA_Illumination_SPole65S_240m_EQ/1.0.0/default/default028mm|png|7"
MARS_MDIM="trek|$TREK/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm|jpg|7"
MARS_MOLA="trek|$TREK/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm|jpg|7"
EARTH_BMNG="gibs|$GIBS/BlueMarble_NextGeneration/default/default/500m|jpeg|7"
EARTH_ASTER="gibs|$GIBS/ASTER_GDEM_Color_Shaded_Relief/default/default/31.25m|jpeg|11"

GLOBAL_Z=3   # 4096 × 2048 px en Trek: límite seguro para GPUs integradas

# Radios en km, para pasar del ancho del recorte en km a grados
declare -A RADIUS_KM=([earth]=6371 [mars]=3389.5 [moon]=1737.4)

# Recortes para la vista de imágenes: id|cuerpo|lat|lon (°E, −180..180)|ancho km.
# La aplicación lee las ubicaciones desde planetary_candidates.csv; añade entradas aquí solo
# cuando quieras generar también las imágenes locales de un sitio nuevo para el panel NASA.
SITES=$(cat <<'EOF'
jezero|mars|18.38|77.58|250
gale|mars|-5.40|137.80|250
meridiani|mars|-1.95|-5.53|250
arsia|mars|-8.26|-120.10|250
utopia|mars|46.70|117.50|250
marius|moon|14.09|-56.80|128
aristarchus|moon|23.70|-47.40|128
tranquillitatis|moon|8.34|33.22|128
earth_salda|earth|37.55|29.68|250
earth_hanksville|earth|38.41|-110.79|250
earth_lajoya|earth|-16.73|-71.87|250
earth_riotinto|earth|37.72|-6.55|250
earth_lavabeds|earth|41.71|-121.51|250
earth_devon|earth|75.38|-89.68|250
earth_lanzarote|earth|29.16|-13.44|128
earth_spcrater|earth|35.58|-111.63|128
earth_cratersmoon|earth|43.42|-113.52|128
earth_mcmurdo|earth|-77.50|162.00|120
EOF
)

log() { printf '\033[1;36m›\033[0m %s\n' "$*"; }

# Comprueba que las herramientas existen antes de lanzar cientos de descargas.
check_deps() {
  local dep
  for dep in curl awk xargs magick python3; do
    command -v "$dep" >/dev/null || { echo "Falta '$dep' en el PATH" >&2; exit 1; }
  done
}

# Separa una capa en sus campos. Uso: read -r grid url ext zmax < <(layer_fields "$CAPA")
layer_fields() { tr '|' ' ' <<< "$1"; }

# Ruta de una tile en la caché (derivada de la URL para no mezclar capas). Args: url z fila col ext
tile_path() { local u="${1#https://}"; echo "$CACHE/${u//[^A-Za-z0-9._\/-]/_}/$2/$3/$4.$5"; }

# Descarga una tile. Un 404 es zona sin cobertura, no un error: se marca para que el
# ensamblado ponga transparencia en su lugar. Args: url_base ext z fila columna
fetch_tile() {
  local url="$1" ext="$2" z="$3" row="$4" col="$5"
  local u="${url#https://}" dest
  dest="$CACHE/${u//[^A-Za-z0-9._\/-]/_}/$z/$row/$col.$ext"
  [[ -s "$dest" || -e "$dest.missing" ]] && [[ -z "${FORCE:-}" ]] && return 0
  mkdir -p "$(dirname "$dest")"
  local code
  code=$(curl -s -m 60 --retry 3 -o "$dest" -w '%{http_code}' "$url/$z/$row/$col.$ext" || echo 000)
  if [[ "$code" != 200 ]]; then rm -f "$dest"; touch "$dest.missing"; fi
}
export -f fetch_tile
export CACHE

# Descarga en paralelo un bloque de tiles. Args: capa z fila0 fila1 col0 col1
fetch_block() {
  local grid url ext zmax r c
  read -r grid url ext zmax < <(layer_fields "$1")
  for ((r = $3; r <= $4; r++)); do
    for ((c = $5; c <= $6; c++)); do echo "$url $ext $2 $r $c"; done
  done | xargs -P "$JOBS" -n 5 bash -c 'fetch_tile "$@"' _
}

# Une un bloque de tiles en una imagen; las que faltan quedan transparentes.
# Args: capa z fila0 fila1 col0 col1 salida
stitch_block() {
  local grid url ext zmax
  read -r grid url ext zmax < <(layer_fields "$1")
  local tile=256; [[ "$grid" == gibs ]] && tile=512
  local blank="$CACHE/blank_$tile.png"
  [[ -s "$blank" ]] || magick -size "${tile}x${tile}" xc:none "$blank"
  local rows=() r c f
  for ((r = $3; r <= $4; r++)); do
    local tiles=()
    for ((c = $5; c <= $6; c++)); do
      f=$(tile_path "$url" "$2" "$r" "$c" "$ext")
      if [[ -s "$f" ]]; then tiles+=("$f"); else tiles+=("$blank"); fi
    done
    rows+=("(" "${tiles[@]}" "+append" ")")
  done
  magick "${rows[@]}" -append +repage "$7"
}

# Mosaico global equirectangular (el mapeo UV de SphereGeometry en Three.js). Solo rejilla trek.
# Args: capa z salida [opciones de magick...]
build_global() {
  local layer="$1" z="$2" out="$3"; shift 3
  [[ -s "$out" && -z "${FORCE:-}" ]] && { log "ya existe $(basename "$out")"; return; }
  log "global z$z → $(basename "$out")"
  local cols=$((2 ** (z + 1))) rows=$((2 ** z))
  fetch_block "$layer" "$z" 0 $((rows - 1)) 0 $((cols - 1))
  stitch_block "$layer" "$z" 0 $((rows - 1)) 0 $((cols - 1)) "$CACHE/tmp_global.png"
  magick "$CACHE/tmp_global.png" -strip "$@" "$out"
}

# Recorte cuadrado de `ancho_km` centrado en (lat, lon).
# En equirectangular un grado de longitud mide cos(lat) veces uno de latitud, así que se toman
# más grados de longitud y se reescala a cuadrado: el resultado no sale estirado.
# El zoom se elige solo: el menor que da ≥ 768 px de alto, sin pasar del máximo de la capa.
# Args: capa cuerpo lat lon ancho_km salida
build_patch() {
  local layer="$1" body="$2" lat="$3" lon="$4" km="$5" out="$6"
  local grid url ext zmax
  read -r grid url ext zmax < <(layer_fields "$layer")
  local z x0 y0 w h
  read -r z x0 y0 w h < <(awk -v g="$grid" -v zmax="$zmax" -v lat="$lat" -v lon="$lon" \
      -v km="$km" -v R="${RADIUS_KM[$body]}" -v want="$SITE_PX" 'BEGIN {
    pi = atan2(0, -1)
    tile = (g == "gibs") ? 512 : 256; deg0 = (g == "gibs") ? 288 : 180
    dlat = km / (2 * pi * R / 360); dlon = dlat / cos(lat * pi / 180)
    for (z = 0; z < zmax; z++) if (dlat * tile / (deg0 / 2 ^ z) >= want) break
    ppd = tile / (deg0 / 2 ^ z)
    w = dlon * ppd; h = dlat * ppd
    printf "%d %d %d %d %d\n", z, (lon + 180) * ppd - w / 2, (90 - lat) * ppd - h / 2, w, h }')
  local tile=256; [[ "$grid" == gibs ]] && tile=512
  local c0=$((x0 / tile)) c1=$(((x0 + w) / tile)) r0=$((y0 / tile)) r1=$(((y0 + h) / tile))
  fetch_block "$layer" "$z" "$r0" "$r1" "$c0" "$c1"
  stitch_block "$layer" "$z" "$r0" "$r1" "$c0" "$c1" "$CACHE/tmp_patch.png"
  # Se estira el contraste porque mares lunares y llanuras salen casi uniformes; es solo para
  # verlos mejor, no se usa para medir nada.
  magick "$CACHE/tmp_patch.png" -crop "${w}x${h}+$((x0 - c0 * tile))+$((y0 - r0 * tile))" +repage \
    -background black -flatten -resize "${SITE_PX}x${SITE_PX}!" \
    -channel RGB -contrast-stretch 0.5%x0.5% +channel -strip -quality 85 "$out"
}

# Vista polar del polo sur lunar (Shackleton y la región de Artemis III).
# Cerca del polo la proyección ecuatorial estira todo; se reproyecta la franja polar a un disco
# centrado en el polo, que es como se ve desde arriba.
build_south_pole() {
  local z=6 out="$OUT_SITES/shackleton_relief.jpg"
  [[ -s "$out" && -z "${FORCE:-}" ]] && { log "ya existe $(basename "$out")"; return; }
  log "polo sur lunar (LOLA) → $(basename "$out")"
  local cols=$((2 ** (z + 1))) row=$((2 ** z - 1))
  fetch_block "$MOON_LOLA" "$z" "$row" "$row" 0 $((cols - 1))
  stitch_block "$MOON_LOLA" "$z" "$row" "$row" 0 $((cols - 1)) "$CACHE/tmp_pole.png"
  # La última fila de tiles cubre de −87.1875° a −90°; se muestran los 2° más cercanos al polo (~60 km)
  python3 -I "$ROOT/scripts/polar_reproject.py" "$CACHE/tmp_pole.png" -87.1875 2 "$SITE_PX" "$out"
}

# Banda de sombra permanente (PSR) del polo sur lunar, de −78.75° a −90°.
# A escala global los PSR medirían 1–2 px; con solo la banda polar en z4 (8192 × 256 px)
# se ven nítidos. La app la pega sobre un casquete esférico que cubre esas latitudes.
build_psr_band() {
  local z=4 out="$OUT_TEX/moon_psr_south_mask.png"
  [[ -s "$out" && -z "${FORCE:-}" ]] && { log "ya existe $(basename "$out")"; return; }
  log "banda PSR polo sur z$z → $(basename "$out")"
  local cols=$((2 ** (z + 1))) row=$((2 ** z - 1))
  fetch_block "$MOON_PSR" "$z" "$row" "$row" 0 $((cols - 1))
  stitch_block "$MOON_PSR" "$z" "$row" "$row" 0 $((cols - 1)) "$CACHE/tmp_psr.png"
  # La capa viene como negro sobre transparente; se guarda solo la máscara (blanco = PSR)
  # para que la app la use como alphaMap y elija el color del resaltado.
  magick "$CACHE/tmp_psr.png" -alpha extract -strip "$out"
}

main() {
  check_deps
  mkdir -p "$OUT_TEX" "$OUT_SITES" "$CACHE"

  build_global "$MOON_WAC"  "$GLOBAL_Z" "$OUT_TEX/moon_lro_wac.jpg"     -quality 88
  build_global "$MARS_MDIM" "$GLOBAL_Z" "$OUT_TEX/mars_viking_mdim.jpg" -quality 88
  build_psr_band

  local id body lat lon km vis rel
  while IFS='|' read -r id body lat lon km; do
    [[ -z "$id" ]] && continue
    case "$body" in
      mars)  vis="$MARS_MDIM";  rel="$MARS_MOLA" ;;
      moon)  vis="$MOON_WAC";   rel="$MOON_LOLA" ;;
      earth) vis="$EARTH_BMNG"; rel="$EARTH_ASTER" ;;
    esac
    if [[ -s "$OUT_SITES/${id}_relief.jpg" && -z "${FORCE:-}" ]]; then log "ya existe $id"; continue; fi
    log "recorte $id ($body $lat, $lon, $km km)"
    build_patch "$vis" "$body" "$lat" "$lon" "$km" "$OUT_SITES/${id}_visible.jpg"
    build_patch "$rel" "$body" "$lat" "$lon" "$km" "$OUT_SITES/${id}_relief.jpg"
  done <<< "$SITES"

  build_south_pole

  log "listo:"
  du -sh "$OUT_TEX" "$OUT_SITES"
}

main "$@"
