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

También se puede ejecutar el paquete sin instalar el entry point:

```bash
PYTHONPATH=backend/src python3 -m planetary_backend.cli analyze --body mars
```

## Qué calcula

- **Desnivel:** rango local máximo–mínimo en una ventana de 3 × 3 celdas de análisis.
- **Pendiente segura:** porcentaje de celdas en esa ventana con pendiente de hasta 15°.
- **Requisito lunar:** aproximación geométrica de si la ubicación está en el hemisferio visible desde la Tierra (0% o 100%). No modela el horizonte topográfico ni la libración.
- **Requisito marciano:** densidad estimada con `0.020 * exp(-elevación_km / 11.1)`, la aproximación que ya figura en el README del proyecto.

El DEM se remuestrea a una malla cuyo tamaño en el ecuador se aproxima a `--grid-km` (10 km por defecto). Para una prueba más gruesa o rápida, aumenta ese valor. Las puntuaciones usan los pesos de grupos de `parameter_model.json` y los criterios heurísticos transparentes de `config/site_selection.json`. El valor de albedo se conserva, pero no se puntúa porque el modelo no define qué albedo favorece cada actividad.

Las capas opcionales `sunlight`, `albedo`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se declaran en `examples/moon_manifest.json` o `examples/mars_manifest.json`. `iceConfidence` se informa aparte y nunca se mezcla con el puntaje de hielo. Una métrica sin raster de entrada queda como `null`; no se rellena con datos inventados. Por eso los resultados iniciales usando solo DEM son parciales. Se aceptan coordenadas geográficas o proyección equirectangular simple (EQC); los DEM LOLA/MOLA globales descargados por este backend usan EQC proyectada en metros.

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

La capa debe ser un raster geográfico/equirectangular del mismo cuerpo y usar exactamente el CRS planetario del DEM. El campo `scale` transforma los valores almacenados a las unidades indicadas. Valores de `sunlight`, `safeSlope`, `craterFree`, `soilStability`, `ice` e `iceConfidence` se expresan en 0–100; `albedo` usa sus unidades reflectivas. Los valores con confianza baja deben conservarse en la capa y documentarse en `source_id`/`source_url`.

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

Las capas que usa actualmente `scripts/fetch-trek.sh` son tiles WMTS renderizadas para visualización. El backend no interpreta los colores del mapa como mediciones. Los DEM numéricos base se descargan de USGS Astrogeology (productos LOLA y MOLA); las fuentes adicionales pueden catalogarse en PDS/ODE o Trek y añadirse como GeoTIFF medido/procesado en los manifiestos. `config/source_catalog.json` guarda las referencias y los productos de partida.

La resolución global de LOLA/MOLA y la malla aproximada no detectan riesgos a escala de rover/aterrizador. El puntaje es un filtro exploratorio, no una validación de seguridad de misión. Las escalas 15° y 2.000 m están configuradas para pruebas y deben revisarse antes de interpretar el resultado científicamente.
