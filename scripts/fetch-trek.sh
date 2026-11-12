#!/usr/bin/env bash
# Descarga capas de NASA Solar System Treks (trek.nasa.gov) y las deja listas en public/.
#
# Se ejecuta una sola vez (no en cada build): la app sirve los archivos locales para que la
# demo no dependa de que Trek responda ese día.
#
# Requisitos: bash, curl, awk, xargs e ImageMagick 7 (`magick`).
# Uso:        ./scripts/fetch-trek.sh            (desde la raíz del repo)
#             FORCE=1 ./scripts/fetch-trek.sh    (vuelve a descargar todo)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_TEX="$ROOT/public/textures/trek"
OUT_SITES="$ROOT/public/trek/sites"
CACHE="${TREK_CACHE:-$ROOT/.trek-cache}"   # tiles crudas; está en .gitignore
BASE="https://trek.nasa.gov/tiles"
TMS="1.0.0/default/default028mm"
JOBS="${JOBS:-8}"

# Capas usadas (identificadores del catálogo de Trek, proyección ecuatorial)
MOON_WAC="Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02:jpg"          # LRO WAC, imagen visible ~100 m/px
MOON_LOLA_SHADE="Moon/EQ/LRO_LOLA_Shade_Global_256ppd_v06:png"    # LOLA, relieve sombreado (z máx. 6)
MOON_PSR="Moon/EQ/LRO_LOLA_Illumination_SPole65S_240m_EQ:png"     # Regiones en sombra permanente (sur)
MARS_MDIM="Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m:jpg"  # Viking MDIM 2.1 color (z máx. 7)
MARS_MOLA_CLR="Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m:jpg" # MOLA, relieve coloreado

GLOBAL_Z=3     # 2^(z+1) × 2^z tiles de 256 px → 4096 × 2048, límite seguro para GPUs integradas
# Zoom de los recortes por sitio. z7 ≈ 182 px/grado: 768 px cubren ~4.2° (≈250 km en Marte,
# ≈128 km en la Luna). Es el máximo que ofrece Viking MDIM; el relieve de la Luna (LOLA) llega
# solo a z6, así que se recorta la mitad y se reescala para que ambas vistas cubran lo mismo.
SITE_Z=7
SITE_PX=768

# Sitios objetivo: id|cuerpo|lat|lon (°E, −180..180).
# Mantener sincronizado con src/trekSites.js, que tiene los textos de cada sitio.
SITES=$(cat <<'EOF'
jezero|mars|18.38|77.58
gale|mars|-5.40|137.80
meridiani|mars|-1.95|-5.53
arsia|mars|-8.26|-120.10
utopia|mars|46.70|117.50
marius|moon|14.09|-56.80
aristarchus|moon|23.70|-47.40
tranquillitatis|moon|8.34|33.22
EOF
)

log() { printf '\033[1;36m›\033[0m %s\n' "$*"; }

# Comprueba que las herramientas existen antes de lanzar cientos de descargas.
check_deps() {
  local dep
  for dep in curl awk xargs magick; do
    command -v "$dep" >/dev/null || { echo "Falta '$dep' en el PATH" >&2; exit 1; }
  done
}

# Descarga una tile a la caché. Una tile que falta (404) es zona sin cobertura, no un error:
# se deja vacía para que el ensamblado ponga transparencia en su lugar.
# Args: capa:ext z fila columna
fetch_tile() {
  local layer="${1%%:*}" ext="${1##*:}" z="$2" row="$3" col="$4"
  local dest="$CACHE/$layer/$z/$row/$col.$ext"
  [[ -s "$dest" || -e "$dest.missing" ]] && [[ -z "${FORCE:-}" ]] && return 0
  mkdir -p "$(dirname "$dest")"
  local code
  code=$(curl -s -m 60 --retry 3 -o "$dest" -w '%{http_code}' \
    "$BASE/$layer/$TMS/$z/$row/$col.$ext" || echo 000)
  if [[ "$code" != 200 ]]; then
    rm -f "$dest"; touch "$dest.missing"
  fi
}
export -f fetch_tile
export BASE TMS CACHE

# Descarga en paralelo un bloque rectangular de tiles. Args: capa z fila0 fila1 col0 col1
fetch_block() {
  local layer="$1" z="$2" r0="$3" r1="$4" c0="$5" c1="$6" r c
  for ((r = r0; r <= r1; r++)); do
    for ((c = c0; c <= c1; c++)); do echo "$layer $z $r $c"; done
  done | xargs -P "$JOBS" -n 4 bash -c 'fetch_tile "$@"' _
}

# Une un bloque de tiles en una sola imagen; las tiles faltantes se rellenan con transparencia.
# Args: capa z fila0 fila1 col0 col1 salida
stitch_block() {
  local layer="${1%%:*}" ext="${1##*:}" z="$2" r0="$3" r1="$4" c0="$5" c1="$6" out="$7"
  local rows=() r c f
  for ((r = r0; r <= r1; r++)); do
    local tiles=()
    for ((c = c0; c <= c1; c++)); do
      f="$CACHE/$layer/$z/$r/$c.$ext"
      if [[ -s "$f" ]]; then tiles+=("$f"); else tiles+=("$CACHE/blank.png"); fi
    done
    rows+=("(" "${tiles[@]}" "+append" ")")
  done
  magick "${rows[@]}" -append +repage "$out"
}

# Mosaico global equirectangular: es justo el mapeo UV de SphereGeometry en Three.js.
# Args: capa:ext z salida [fila_inicial]  (fila_inicial > 0 para capas que solo cubren el sur)
build_global() {
  local layer="$1" z="$2" out="$3" r0="${4:-0}"
  local cols=$((2 ** (z + 1))) rows=$((2 ** z))
  [[ -s "$out" && -z "${FORCE:-}" ]] && { log "ya existe $(basename "$out")"; return; }
  log "global $layer z$z → $(basename "$out")"
  fetch_block "$layer" "$z" "$r0" $((rows - 1)) 0 $((cols - 1))
  local tmp="$CACHE/tmp_global.png"
  stitch_block "$layer" "$z" "$r0" $((rows - 1)) 0 $((cols - 1)) "$tmp"
  # Las filas sin cobertura se añaden arriba como transparencia para conservar la proyección
  magick -size $((cols * 256))x$((rows * 256)) xc:none "$tmp" -gravity south -composite \
    -strip "${@:5}" "$out"
}

# Recorte cuadrado centrado en (lat, lon). Se baja solo el bloque de tiles que cubre el recorte.
# Se estira el contraste porque los mares lunares y las llanuras salen casi uniformes; es solo
# para verlos mejor, no se usa para medir nada.
# Args: capa:ext z lat lon tamaño_px salida
build_patch() {
  local layer="$1" z="$2" lat="$3" lon="$4" size="$5" out="$6"
  local px py
  read -r px py < <(awk -v z="$z" -v lat="$lat" -v lon="$lon" 'BEGIN {
    n = 2 ^ z; printf "%d %d\n", (lon + 180) / 360 * 512 * n, (90 - lat) / 180 * 256 * n }')
  local half=$((size / 2))
  local c0=$(((px - half) / 256)) c1=$(((px + half) / 256))
  local r0=$(((py - half) / 256)) r1=$(((py + half) / 256))
  fetch_block "$layer" "$z" "$r0" "$r1" "$c0" "$c1"
  local tmp="$CACHE/tmp_patch.png"
  stitch_block "$layer" "$z" "$r0" "$r1" "$c0" "$c1" "$tmp"
  magick "$tmp" -crop "${size}x${size}+$((px - half - c0 * 256))+$((py - half - r0 * 256))" +repage \
    -background black -flatten -resize "${SITE_PX}x${SITE_PX}" \
    -channel RGB -contrast-stretch 0.5%x0.5% +channel -strip -quality 85 "$out"
}

# Vista polar del polo sur lunar (Shackleton y la región de Artemis III).
# Cerca del polo la proyección ecuatorial estira todo; se reproyecta la franja polar a un disco
# centrado en el polo, que es como se ve desde arriba. Requiere python3 con numpy y Pillow.
build_south_pole() {
  local layer="$MOON_LOLA_SHADE" z=6 out="$OUT_SITES/shackleton_relief.jpg"
  [[ -s "$out" && -z "${FORCE:-}" ]] && { log "ya existe $(basename "$out")"; return; }
  log "polo sur lunar (LOLA) → $(basename "$out")"
  local cols=$((2 ** (z + 1))) row=$((2 ** z - 1))
  fetch_block "$layer" "$z" "$row" "$row" 0 $((cols - 1))
  local strip="$CACHE/tmp_pole.png"
  stitch_block "$layer" "$z" "$row" "$row" 0 $((cols - 1)) "$strip"
  # La última fila cubre 2.8125°; nos quedamos con los últimos 2° (−88° a −90°)
  # La última fila de tiles cubre de −87.1875° a −90°; se muestran los 2° más cercanos al polo (~60 km)
  python3 -I "$ROOT/scripts/polar_reproject.py" "$strip" -87.1875 2 "$SITE_PX" "$out"
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
  local tmp="$CACHE/tmp_psr.png"
  stitch_block "$MOON_PSR" "$z" "$row" "$row" 0 $((cols - 1)) "$tmp"
  # La capa viene como negro sobre transparente; se guarda solo la máscara (blanco = PSR)
  # para que la app la use como alphaMap y elija el color del resaltado.
  magick "$tmp" -alpha extract -strip "$out"
}

main() {
  check_deps
  mkdir -p "$OUT_TEX" "$OUT_SITES" "$CACHE"
  [[ -s "$CACHE/blank.png" ]] || magick -size 256x256 xc:none "$CACHE/blank.png"

  build_global "$MOON_WAC"  "$GLOBAL_Z" "$OUT_TEX/moon_lro_wac.jpg"     0 -quality 88
  build_global "$MARS_MDIM" "$GLOBAL_Z" "$OUT_TEX/mars_viking_mdim.jpg" 0 -quality 88
  build_psr_band

  local id body lat lon vis rel rz
  while IFS='|' read -r id body lat lon; do
    [[ -z "$id" ]] && continue
    if [[ "$body" == mars ]]; then vis="$MARS_MDIM"; rel="$MARS_MOLA_CLR"; rz=7
    else vis="$MOON_WAC"; rel="$MOON_LOLA_SHADE"; rz=6; fi
    if [[ -s "$OUT_SITES/${id}_visible.jpg" && -z "${FORCE:-}" ]]; then log "ya existe sitio $id"; continue; fi
    log "sitio $id ($body $lat, $lon)"
    build_patch "$vis" "$SITE_Z"   "$lat" "$lon" "$SITE_PX"                 "$OUT_SITES/${id}_visible.jpg"
    build_patch "$rel" "$rz"     "$lat" "$lon" $((SITE_PX / 2 ** (SITE_Z - rz))) "$OUT_SITES/${id}_relief.jpg"
  done <<< "$SITES"

  build_south_pole

  log "listo:"
  du -sh "$OUT_TEX" "$OUT_SITES"
}

main "$@"
