# Backend de selección aproximada de sitios

Proceso por lotes aislado del frontend. Lee el modelo existente `../public/data/parameter_model.json`, analiza DEM y capas científicas en GeoTIFF y genera un GeoJSON independiente para Luna o Marte. No lee ni modifica `planetary_candidates.csv`.

## Instalación

Usa Python 3.11 o superior y las dependencias rasterio/numpy del entorno local:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e backend
```

Desde la raíz del repositorio:

```bash
backend/.venv/bin/planetary-backend sources
backend/.venv/bin/planetary-backend download-dem --body moon --accept-large-download
backend/.venv/bin/planetary-backend analyze --body moon
```

Para Marte, reemplaza `moon` por `mars`. La descarga trae un DEM global completo, de varios GB. El proceso de análisis no inicia descargas por sí solo.

Para descargar las capas polares numéricas de iluminación y visibilidad terrestre de LOLA (norte y sur) y registrarlas en el manifiesto lunar:

```bash
backend/.venv/bin/planetary-backend download-layer --body moon --layer sunlight --region both --accept-download
backend/.venv/bin/planetary-backend download-layer --body moon --layer earthView --region both --accept-download
backend/.venv/bin/planetary-backend download-layer --body moon --layer ice --region both --accept-download
```

Las capas cubren las regiones polares norte y sur, con resolución nativa de 240 m. `sunlight` expresa el porcentaje promedio de pasos de tiempo en que alguna parte del disco solar es visible; el filtro inicial exige 30%, un límite heurístico ajustado al rango de este producto, no una regla oficial de NASA. `earthView` expresa el porcentaje promedio de pasos de tiempo en que alguna parte del disco terrestre es visible; no modela la calidad de un enlace de radio. Si no se descarga esta última capa, el backend conserva el cálculo geométrico aproximado de visibilidad terrestre.

El comando actualiza `backend/examples/moon_manifest.json`. Para usar otro manifiesto, especifica `--manifest ruta/al/manifiesto.json`. Las descargas polares pueden ocupar decenas o cientos de MB.

`ice` descarga el Ice Favorability Index (IFI) de USGS para los polos norte y sur (GeoTIFF, ~591 m/píxel, ~4 MB cada uno) y los registra en el manifiesto. El índice es predictivo: combina edad geológica, estabilidad térmica, fracción de trampas frías y modelos de impacto; no es una detección de hielo, abundancia ni probabilidad. El backend lo normaliza conjuntamente a 0–100 sobre el rango de ambas capas disponibles, así que representa favorabilidad relativa dentro de la cobertura polar.

Si se carga `ice` y no se proporciona una capa `iceConfidence`, el backend calcula confianza local en el indicador a partir de la cobertura válida y la coherencia espacial en una ventana de 3 × 3 celdas de la malla de análisis. La fórmula es `cobertura válida (%) × (1 − desviación estándar local / 50)`. El resultado (0–100) estima representatividad del valor a escala de análisis; no significa probabilidad de encontrar hielo ni sustituye incertidumbre científica de la fuente. En latitudes altas, la celda geográfica se estrecha de este a oeste. El filtro configurado exige `ice ≥25` e `iceConfidence ≥50`; ambos límites son heurísticos.

También se puede ejecutar el paquete sin instalar el entry point:

```bash
PYTHONPATH=backend/src python3 -m planetary_backend.cli analyze --body mars
```

## Qué calcula

- **Desnivel:** rango local máximo–mínimo en una ventana de 3 × 3 celdas de análisis.
- **Pendiente segura:** porcentaje de celdas en esa ventana con pendiente de hasta 15°.
- **Requisito lunar:** usa la capa de visibilidad promedio LOLA si está cargada; de lo contrario, estima geométricamente el hemisferio visible desde la Tierra (0% o 100%). La capa polar no modela la disponibilidad de un enlace de radio.
- **Requisito marciano:** densidad estimada con `0.020 * exp(-elevación_km / 11.1)`, la aproximación que ya figura en el README del proyecto.

El DEM se remuestrea a una malla cuyo tamaño en el ecuador se aproxima a `--grid-km` (10 km por defecto). Para una prueba más gruesa o rápida, aumenta ese valor. Las puntuaciones usan los pesos de grupos de `parameter_model.json`; los filtros de exclusión y sus límites están en `config/site_selection.json`.

Los umbrales de aprobación no se relajan para aumentar el número de resultados. Además de la lista principal, cada análisis genera una lista exploratoria de hasta 12 alternativas en total. Para completar ese máximo, prioriza primero sitios que pasan los filtros, luego casi aprobados y finalmente ubicaciones sin datos de hielo:

- `passed_but_too_close`: cumple los filtros activos, pero quedó demasiado cerca de un candidato principal según la separación mínima.
- `near_miss`: cumple los demás filtros evaluables y su indicador de hielo queda hasta 5 puntos por debajo del umbral configurado. El margen se cambia con `candidate_defaults.near_miss_margin_points`.
- `ice_unassessed`: no hay dato de hielo en esa celda; los demás filtros aplicables sí se cumplen. Es una ubicación sin evaluar para hielo, no una aprobación del filtro.

Las categorías `near_miss` e `ice_unassessed` respetan la separación mínima respecto a los candidatos principales y entre sí. `passed_but_too_close` contiene precisamente sitios que no respetan esa distancia respecto a los sitios principales, por lo que pueden agruparse en una misma zona. Estos puntos no se mezclan con los candidatos aprobados: cada elemento incluye `candidate_status`, `eligible`, el estado de sus filtros y `selection_detail` con el motivo de inclusión. El GeoJSON principal conserva solo los sitios aprobados. El manifiesto registra cantidades, margen y límites utilizados.

Los filtros iniciales requieren que al menos 80% del entorno analizado tenga pendiente de hasta 15° y que el desnivel local no supere 1.000 m, para ambos cuerpos. Cuando una capa está disponible también se aplican los mínimos configurados de iluminación, peligros, estabilidad e hielo. Un límite opcional se omite si no se cargó su capa; queda indicado como no evaluado en `filters_not_evaluated` y en cada candidato. La visibilidad de la Tierra en la Luna (≥50%) y la densidad marciana estimada (≥0,018 kg/m³) continúan siendo requisitos excluyentes. Todos estos valores son heurísticos para priorización exploratoria, no límites certificados de misión.

Las capas `sunlight`, `albedo`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se declaran en `examples/moon_manifest.json` o `examples/mars_manifest.json`. `earthView` es una capa auxiliar del requisito lunar. El lector reproyecta las capas a la malla DEM y permite combinar varias fuentes por métrica, incluidas las proyecciones estereográficas polares de LOLA. `iceConfidence` se informa aparte y nunca se mezcla con el puntaje de hielo. Si el manifiesto incluye una capa de hielo, pero no una de confianza, se calcula la confianza espacial descrita arriba; sin capa de hielo, ambas métricas quedan como `null`. No se rellenan con valores de hielo inventados.

Para agregar una capa, copia su configuración dentro de `layers` en el manifiesto:

```json
{
  "path": "../data/raw/moon_sunlight.tif",
  "band": 1,
  "scale": 1,
  "offset": 0,
  "units": "%",
  "source_id": "identificador-del-producto",
  "source_url": "https://fuente-oficial/producto"
}
```

La capa debe ser un raster del mismo cuerpo con un CRS planetario reconocido (geográfico, equirectangular o estereográfico polar) y radio compatible. El backend aplica primero el `scale`/`offset` de la banda GeoTIFF y luego los campos `scale`/`offset` del manifiesto. Valores de `sunlight`, `safeSlope`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se expresan en 0–100; `albedo` usa sus unidades reflectivas. Los valores con confianza baja deben conservarse en la capa y documentarse en `source_id`/`source_url`.

## Salidas

Cada ejecución produce:

- `backend/data/outputs/moon_candidates.geojson` o `mars_candidates.geojson`: hasta 200 puntos candidatos, separados por 30 km como valor inicial. Las propiedades contienen coordenadas, parámetros, puntuaciones, requisito aplicado y cobertura.
- `backend/data/outputs/moon_candidate_alternatives.geojson` o `mars_candidate_alternatives.geojson`: lista aparte de puntos aprobados omitidos por proximidad, casi aprobados por hielo y puntos sin cobertura de hielo.
- `backend/data/outputs/moon_run_manifest.json` o `mars_run_manifest.json`: productos y rutas usados, criterios heurísticos, cobertura, parámetros omitidos, cantidades por categoría de alternativa y limitaciones.

La aplicación web aún no consume estos archivos automáticamente; son la salida del backend independiente para revisar y conectar en una etapa posterior.

Se pueden cambiar la malla, cantidad y separación:

```bash
backend/.venv/bin/planetary-backend analyze --body moon --grid-km 20 --limit 100 --minimum-separation-km 50
```

## Papel de Trek y fuentes

Las capas que usa actualmente `scripts/fetch-trek.sh` son tiles WMTS renderizadas para visualización. El backend no interpreta los colores del mapa como mediciones. Los DEM numéricos base se descargan de USGS Astrogeology (productos LOLA y MOLA). `config/source_catalog.json` registra las fuentes adicionales verificadas: iluminación lunar LOLA, el Ice Favorability Index lunar de USGS, Diviner/LEND como fuentes de apoyo, SWIM4IMIM para consistencia de hielo marciano, y TES/Mars Climate Database como fuentes de propiedades térmicas y ambientales.

La descarga automática está disponible para `sunlight`, `earthView` y el IFI de USGS. Diviner PRP proporciona profundidad modelada a hielo estable y LEND aporta evidencia de hidrógeno; son fuentes de apoyo para etapas posteriores, no probabilidades de hielo por sí solas. El IFI es un índice predictivo y la confianza calculada por este backend mide cobertura y coherencia espacial del indicador, no confirmación independiente de hielo. SWIM4IMIM publica consistencia de hielo marciano en GeoTIFF de cobertura parcial; esa consistencia tampoco es una probabilidad. Los productos de peligros de CTX/HiRISE y las capas térmicas de Marte requieren selección/conversión documentada antes de incorporarse al manifiesto.

La resolución global de LOLA/MOLA y la malla aproximada no detectan riesgos a escala de rover/aterrizador. El puntaje es un filtro exploratorio, no una validación de seguridad de misión. Los límites 15°, 80%, 1.000 m y los mínimos restantes están configurados para pruebas y deben revisarse antes de interpretar el resultado científicamente. En particular, el filtro de pendiente se calcula sobre el DEM remuestreado, no sobre un DTM local de resolución de aterrizaje.
