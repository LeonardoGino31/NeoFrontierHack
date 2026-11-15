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
```

Las capas cubren las latitudes 65°–90° de cada polo, con resolución nativa de 240 m. `sunlight` expresa el porcentaje promedio de pasos de tiempo iluminados a lo largo de un ciclo de nutación de unos 18,6 años. `earthView` expresa el porcentaje promedio de pasos de tiempo en que alguna parte del disco terrestre es visible; no modela la calidad de un enlace de radio. Si no se descargan, el backend conserva el cálculo geométrico aproximado de visibilidad terrestre.

El comando actualiza `backend/examples/moon_manifest.json`. Para usar otro manifiesto, especifica `--manifest ruta/al/manifiesto.json`. Las descargas polares pueden ocupar decenas o cientos de MB.

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

Los filtros iniciales requieren que al menos 80% del entorno analizado tenga pendiente de hasta 15° y que el desnivel local no supere 1.000 m, para ambos cuerpos. Cuando una capa está disponible también se aplican los mínimos configurados de iluminación, peligros, estabilidad e hielo. Un límite opcional se omite si no se cargó su capa; queda indicado como no evaluado en `filters_not_evaluated` y en cada candidato. La visibilidad de la Tierra en la Luna (≥50%) y la densidad marciana estimada (≥0,018 kg/m³) continúan siendo requisitos excluyentes. Todos estos valores son heurísticos para priorización exploratoria, no límites certificados de misión.

Las capas `sunlight`, `albedo`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se declaran en `examples/moon_manifest.json` o `examples/mars_manifest.json`. `earthView` es una capa auxiliar del requisito lunar. El lector reproyecta las capas a la malla DEM y permite combinar varias fuentes por métrica, incluidas las proyecciones estereográficas polares de LOLA. `iceConfidence` se informa aparte y nunca se mezcla con el puntaje de hielo. Una métrica sin raster de entrada queda como `null`; no se rellena con datos inventados. Por eso los resultados iniciales usando solo DEM son parciales.

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

La capa debe ser un raster del mismo cuerpo con un CRS planetario reconocido (geográfico, equirectangular o estereográfico polar) y radio compatible. El campo `scale` transforma los valores almacenados a las unidades indicadas. Valores de `sunlight`, `safeSlope`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se expresan en 0–100; `albedo` usa sus unidades reflectivas. Los valores con confianza baja deben conservarse en la capa y documentarse en `source_id`/`source_url`.

## Salidas

Cada ejecución produce:

- `backend/data/outputs/moon_candidates.geojson` o `mars_candidates.geojson`: hasta 200 puntos candidatos, separados por 30 km como valor inicial. Las propiedades contienen coordenadas, parámetros, puntuaciones, requisito aplicado y cobertura.
- `backend/data/outputs/moon_run_manifest.json` o `mars_run_manifest.json`: productos y rutas usados, criterios heurísticos, cobertura, parámetros omitidos y limitaciones.

La aplicación web aún no consume estos archivos automáticamente; son la salida del backend independiente para revisar y conectar en una etapa posterior.

Se pueden cambiar la malla, cantidad y separación:

```bash
backend/.venv/bin/planetary-backend analyze --body moon --grid-km 20 --limit 100 --minimum-separation-km 50
```

## Papel de Trek y fuentes

Las capas que usa actualmente `scripts/fetch-trek.sh` son tiles WMTS renderizadas para visualización. El backend no interpreta los colores del mapa como mediciones. Los DEM numéricos base se descargan de USGS Astrogeology (productos LOLA y MOLA). `config/source_catalog.json` registra las fuentes adicionales verificadas: iluminación lunar de LOLA, productos lunares Diviner/LEND para evaluar como capas de hielo, SWIM4IMIM para consistencia de hielo marciano, y TES/Mars Climate Database como fuentes de propiedades térmicas y ambientales.

La descarga automática de capas adicionales está habilitada para las capas polares LOLA `sunlight` y `earthView`. Para hielo lunar, el producto Diviner PRP del PDS se distribuye como tabla ASCII sobre malla triangular y LEND mide hidrógeno; ninguno equivale por sí mismo a probabilidad de hielo, por lo que no se convierten automáticamente en porcentaje de potencial/confianza. SWIM4IMIM publica consistencia de hielo en GeoTIFF de cobertura parcial; su consistencia tampoco es una probabilidad. Los productos de peligros de CTX/HiRISE y las capas térmicas de Marte requieren selección/conversión documentada antes de incorporarse al manifiesto.

La resolución global de LOLA/MOLA y la malla aproximada no detectan riesgos a escala de rover/aterrizador. El puntaje es un filtro exploratorio, no una validación de seguridad de misión. Los límites 15°, 80%, 1.000 m y los mínimos restantes están configurados para pruebas y deben revisarse antes de interpretar el resultado científicamente. En particular, el filtro de pendiente se calcula sobre el DEM remuestreado, no sobre un DTM local de resolución de aterrizaje.
