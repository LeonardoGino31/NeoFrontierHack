# NeoFrontier

Plataforma interactiva para encontrar y comparar **análogos terrestres** de regiones de Marte y la Luna, construida con Three.js.

## Funcionalidades

- **Globo 3D** de la Tierra, Marte y la Luna con texturas reales, atmósfera, nubes y luces nocturnas.
- **Puntos de análisis** sobre la Tierra: al seleccionar uno, se muestra lado a lado con su análogo en Marte o la Luna.
- **HUD de similitud** con 3 grupos comparados (iluminación, topografía y potencial de hielo) y un requisito del sitio según el objetivo de cada cuerpo: **Luna = estación base** (comunicación con la Tierra) y **Marte = aterrizaje y recorridos** (densidad del aire para el descenso).
- **Guía de parámetros**: explica qué mide cada parámetro, por qué importa, qué datasets se usarán y cómo se calcula, con un simulador interactivo.
- **Imágenes reales de NASA Trek**: Marte y la Luna usan mosaicos de [Mars Trek](https://trek.nasa.gov/mars/) y [Moon Trek](https://trek.nasa.gov/moon/) (Viking MDIM 2.1, LRO WAC). Hay recortes de imagen y relieve (MOLA / LOLA) de los sitios conocidos (Jezero, Gale, Meridiani, Arsia Mons, Utopia, Colinas de Marius, Aristarco, pozo de Tranquilidad, Shackleton y las regiones de Artemis III).
- **Candidatos y sus análogos encontrados**: los puntos de la Luna y Marte son los candidatos que eligió el backend de selección de sitios, sin duplicados y con nombre de la nomenclatura de la IAU. Cada uno se empareja con la celda de la Tierra más parecida que encontró la búsqueda global del pipeline, comparando terreno, luz, albedo, suelo, hielo y **litología**. Los análogos clásicos (Lago Salda, Río Tinto, McMurdo…) ya no se muestran como parejas: sirven para **validar** la búsqueda.
- **Comparación Tierra | análogo**: el panel inferior muestra ambos con imagen y relieve reales al **mismo ancho en km** (Tierra: Blue Marble NG y ASTER GDEM de [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)), y explica dónde falla la analogía. Las imágenes se generan con `scripts/fetch_pair_images.py` (ver más abajo); hay que volver a ejecutarlo después de `python -m pipeline pairs`, igual que `python -m pipeline lab-terrain` para el laboratorio.
- **Navegación**: botones Marte / Luna para cambiar de cuerpo, flechas ‹ › (o ← →) para recorrer sus puntos, y arrastre de cada cuerpo por separado en el modo comparación.
- **Sombra permanente del polo sur lunar**: capa de LRO LOLA con las regiones donde nunca da el sol (posible hielo), activable al ver la Luna.
- **Laboratorio 3D**: recorte real de 20 × 20 km de cada punto (candidatos de la Luna y Marte y sus análogos en la Tierra): relieve de MOLA, LOLA o Copernicus DEM con la imagen orbital encima (Viking + THEMIS, LRO WAC, Sentinel-2 cloudless). Cada parámetro se visualiza sobre ese relieve; se elige el punto en el panel o se abre directamente en el punto seleccionado del globo.
- **Rovers en el laboratorio**: Perseverance, Sojourner (Marte), Apollo LRV y Yutu-2 (Luna) modelados en 3D a escala real, con ruedas que giran y se orientan y suspensión que copia el suelo; se conducen sobre el terreno del punto elegido.
- **Backend experimental de sitios**: proceso Python separado para priorizar ubicaciones aproximadas en Luna y Marte desde DEM científicos y capas raster opcionales. Exporta candidatos con coordenadas y métricas a GeoJSON; `python -m pipeline candidates` los pasa al CSV de la app.

> Estado actual: los sitios, sus parejas y casi todos los valores (209 de 225 en las parejas) vienen de datos abiertos medidos por el pipeline; lo que falta (suelo de Marte y del polo lunar) se marca como *Demo*. Las fichas de los análogos destacados están en [`docs/fichas-analogos.md`](docs/fichas-analogos.md).

## Validación de la búsqueda

Los 13 análogos clásicos (Lago Salda–Jezero, Craters of the Moon–Tranquilidad, McMurdo–Shackleton…) no se usan para buscar: se usa el puesto que obtienen entre todas las celdas de tierra (`public/data/validation.json`, `python -m pipeline validation`). Percentil mediano (top X %, menor es mejor):

| Método | Luna (7) | Marte (6) | Todos (13) |
|---|---|---|---|
| Anterior: solo parámetros físicos | 41,4 % | 39,1 % | 40,6 % |
| Actual: sin la luz de Marte y con litología | 39,2 % | 26,9 % | 28,5 % |

La litología acierta donde la roca define el análogo: Craters of the Moon pasa del top 32 % al **1,2 %** y Lava Beds (Arsia Mons) del 41 % al **1,4 %**. En cambio, empeora en los análogos elegidos por operación, altitud o frío (Mauna Kea, Domo C). El ranking por dimensión (`pairs[].byGroup`) muestra en qué se parece cada uno; no hay un único «mejor análogo».

## Criterios para calcular los porcentajes

La guía de parámetros explica qué significa cada indicador. La búsqueda global (`pipeline/search.py`) usa estos mismos `span`, grupos y pesos, solo con los parámetros medidos en ambos lados, y añade la **litología** (`parameter_model.json → geology`, peso 1,5 en la Luna y 2 en Marte). La litología traduce GLiM (Tierra), el Unified Geologic Map (Luna) y SIM 3292 (Marte) a clases comunes y las compara con la matriz de afinidad de `pipeline/geology.json`. En Marte se excluye la luz solar (`searchExclude`) porque vale ~50 % en casi todo el planeta y empujaba la búsqueda hacia desiertos sin nubes. La app (HUD) aún no muestra la litología.

### Objetivo de cada cuerpo

| Cuerpo | Objetivo | Peso de los grupos | Requisito del sitio |
|---|---|---|---|
| Luna | Estación base permanente | Iluminación ×1.5 · Topografía ×1 · Hielo ×1.5 · Litología ×1.5 (búsqueda) | Comunicación con la Tierra ≥ 50 % del tiempo |
| Marte | Aterrizaje y recorridos de rover | Iluminación ×0.5 (solo albedo en la búsqueda) · Topografía ×2 · Hielo ×1 · Litología ×2 (búsqueda) | Densidad del aire ≥ 0.010 kg/m³ (mínimo del año a las 15 h; Jezero, Gale y Meridiani lo cumplen) |

### Parámetros comparados (Tierra – análogo)

Cada subparámetro numérico se compara con `100 × max(0, 1 − |Tierra − análogo| / span)`. Un grupo es el promedio de sus subparámetros y el índice global es el promedio de los grupos con los pesos del cuerpo. La litología es categórica: vale la afinidad entre las dos clases (1 = misma roca).

| Grupo | Subparámetro | Tierra | Luna | Marte |
|---|---|---|---|---|
| Iluminación | Tiempo con luz solar | Día × cielo despejado (MODIS) | Mapas de LOLA en el polo; geometría en el resto | Geometría (no entra en la búsqueda) |
| Iluminación | Albedo | MODIS MCD43C3 | LOLA 1064 nm | TES bolométrico |
| Topografía | Desnivel, pendiente segura, libre de obstáculos | Copernicus DEM 90 m | LOLA 118–120 m | MOLA 463 m |
| Topografía | Estabilidad del suelo (índice relativo al cuerpo) | Inercia térmica aparente (MODIS) | Abundancia de rocas de Diviner (70° S–70° N) | Sin dato |
| Hielo | Potencial de hielo, con **confianza** aparte | Nieve (MODIS) o permafrost (Obu et al.) | Sombra permanente (LOLA) | Hidrógeno de Mars Odyssey GRS |
| Litología | Clase de roca | GLiM 0,5° | Unified Geologic Map 1:5M | SIM 3292 1:20M |

### Requisitos del sitio (no se comparan con la Tierra)

La Tierra no puede reproducir el horizonte lunar ni la atmósfera marciana, así que estos valores solo se miden en el sitio y funcionan como **filtro**: un sitio que no cumple se marca como *no apto*, aunque su análogo se parezca mucho.

| Cuerpo | Requisito | Datos |
|---|---|---|
| Luna | Comunicación con la Tierra | Mapas de visibilidad de la Tierra de LOLA (PGDA) en el polo; cara visible = 100 % por geometría |
| Marte | Densidad del aire en superficie | Mars Climate Database v6.2 (el backend usa aún una fórmula por elevación) |

### Reglas para el índice global

- Los requisitos del sitio son **filtros obligatorios**; una buena similitud no compensa un riesgo de aterrizaje o la falta de enlace con la Tierra.
- Evitar doble conteo: cráteres y rocas forman un solo subparámetro; la pendiente se mide aparte.
- Mostrar la confianza del dato por separado del valor, especialmente para el hielo.
- Un parámetro que no distingue sitios en un cuerpo se excluye de la búsqueda (`searchExclude`).
- La temperatura no forma parte del modelo.

## Tecnologías

- [Three.js](https://threejs.org/) — visualización 3D
- [Vite](https://vite.dev/) — servidor de desarrollo y build
- JavaScript (ES Modules), HTML y CSS

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

### Datos de NASA Trek

Las imágenes ya están en `public/`. La lista de recortes de `scripts/fetch-trek.sh` solo se usa para crear esas imágenes. Al añadir una pareja al CSV no hace falta tocarla para que funcionen el marcador y la similitud; actualízala después solo si quieres generar también imágenes locales para el panel NASA.

```bash
./scripts/fetch-trek.sh          # descarga solo lo que falta
FORCE=1 ./scripts/fetch-trek.sh  # vuelve a descargar todo
```

Requiere `curl`, ImageMagick 7 (`magick`) y `python3` con `numpy` y `Pillow` (solo para la vista polar). Las tiles crudas quedan en `.trek-cache/`, que no se versiona. Usa los servicios WMTS públicos de Trek (`https://trek.nasa.gov/tiles/...`) y GIBS (`https://gibs.earthdata.nasa.gov/wmts/...`).

### Backend de ubicaciones lunares y marcianas

El backend está aislado en `backend/` y funciona por lotes. Trek conserva su papel de catálogo y visualización: sus tiles WMTS son imágenes renderizadas. Para medir relieve y pendiente, el backend usa DEM numéricos LOLA/MOLA descargados desde USGS/PDS. Puedes descargar el DEM global de referencia (varios GB) de forma explícita:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e backend
backend/.venv/bin/planetary-backend sources
backend/.venv/bin/planetary-backend download-dem --body moon --accept-large-download
backend/.venv/bin/planetary-backend download-dem --body mars --accept-large-download
backend/.venv/bin/planetary-backend analyze --body moon
backend/.venv/bin/planetary-backend analyze --body mars
```

Los comandos `analyze` escriben `backend/data/outputs/moon_candidates.geojson`, `mars_candidates.geojson` y sus manifiestos de procedencia. Los GeoJSON contienen puntos candidatos separados espacialmente, valores de parámetros, puntuaciones de grupos, filtros aplicados y cobertura de datos. Las entradas opcionales se declaran en `backend/examples/moon_manifest.json` y `mars_manifest.json`; se aceptan GeoTIFF geográficos o equirectangulares del mismo cuerpo y CRS planetario que el DEM. `sunlight`, `albedo`, `craterFree`, `soilStability`, `ice` e `iceConfidence` quedan nulos mientras no se proporcione una capa correspondiente.

La pendiente y el desnivel se derivan del DEM remuestreado a una malla aproximada. La visibilidad lunar de la Tierra usa una aproximación geométrica del hemisferio visible; la densidad atmosférica de Marte usa la fórmula simplificada que ya se documenta en la guía. El puntaje solo usa parámetros con dato y criterio configurado, por eso el resultado incluye cobertura y puede ser parcial. No es una evaluación de ingeniería ni una recomendación de misión. Las reglas y escalas heurísticas están en `backend/config/site_selection.json`; las fuentes y productos base están en `backend/config/source_catalog.json`.

### Datos de ubicaciones y similitud

- `public/data/planetary_candidates.csv` es la fuente de ubicaciones y sus datos. Contiene registros autónomos de candidatos lunares/marcianos (del backend) y, por cada uno, una pareja Tierra–análogo cuyo punto terrestre es el análogo que encontró la búsqueda del pipeline (`python -m pipeline pairs`, ver [`pipeline/README.md`](pipeline/README.md)). Los registros de candidatos no tienen coordenadas terrestres ni calculan similitud; sus parejas sí.
- El encabezado del CSV sigue este orden de bloques:

  1. **Identificadores:** `pair_id`, `earth_site_id`, `candidate_id`, `body`.
  2. **Sitio terrestre:** `earth_site_name`, `earth_region`, `earth_latitude`, `earth_longitude`, `earth_kind`, `earth_description`, `earth_limits`.
  3. **Análogo lunar o marciano:** `analog_site_name`, `analog_latitude`, `analog_longitude`, `footprint_km`, `analog_kind`, `analog_description`, `analog_polar`.
  4. **Estado del registro:** `data_status`.
  5. **Valores comparados**, en este orden: `sunlight_earth`, `sunlight_analog`; `albedo_earth`, `albedo_analog`; `relief_earth`, `relief_analog`; `safe_slope_earth`, `safe_slope_analog`; `crater_free_earth`, `crater_free_analog`; `soil_stability_earth`, `soil_stability_analog`; `ice_earth`, `ice_analog`; `ice_confidence_earth`, `ice_confidence_analog`. La confianza del hielo se muestra aparte y no se incluye en el índice.
  6. **Requisito del sitio** (solo del análogo): `earth_view_analog` (% del tiempo, solo Luna) y `descent_density_analog` (kg/m³, solo Marte). La columna que no aplica al cuerpo se deja vacía.
  7. **Registros de candidatos** (columnas añadidas al final): `record_type`, `candidate_status`, `candidate_eligible`, `candidate_filter_status`, puntaje y cobertura, más objetos JSON con puntuaciones por grupo/parámetro, filtros, motivo de selección y `candidate_factor_metadata_json` (método, tipo, fuente, confianza y límites de cada factor descriptivo).
- Las parejas existentes usan `record_type=pair` (o dejan la columna vacía). Para agregar una pareja, añade una fila debajo del encabezado con `pair_id` y `earth_site_id` únicos, ambos puntos y los valores numéricos comparados.
- Un candidato sin contraparte terrestre usa `record_type=candidate_only`, `candidate_id` único y las columnas del sitio lunar/marciano y sus factores. Las columnas de la Tierra y `pair_id` se dejan vacías; no se inventa una coincidencia ni se calcula similitud.
- Las filas `candidate_only` las genera `python -m pipeline candidates` a partir de `backend/data/outputs/*.geojson`: entran los candidatos elegidos (`selected`) y los que casi pasan los filtros (`near_miss`), separados al menos 30 km en la Luna y 300 km en Marte (`candidateRows` en `pipeline/config.json`). Las alternativas `passed_but_too_close` no entran porque, por definición, repiten un sitio ya elegido. Hoy son 3 candidatos lunares (polo sur, cerca de Mons Cabeus) y 12 marcianos.
- Las columnas finales `geology_analog` y `geology_unit_analog` guardan la clase litológica común y la unidad del mapa geológico (Unified Geologic Map de la Luna, SIM 3292 de Marte); en las parejas, `geology_earth` es la clase de GLiM de la celda terrestre y `geology_similarity` su afinidad (0–1, `pipeline/geology.json`). La app todavía no las muestra.
- En una pareja, `earth_latitude` / `earth_longitude` posicionan el punto seleccionable en la Tierra y las coordenadas del análogo lo posicionan en Marte o la Luna. En un candidato autónomo solo se muestra el marcador en su cuerpo; al seleccionarlo aparecen su puntaje de selección, factores disponibles, requisito y estado de filtros.
- Usa un `earth_site_id` único por punto seleccionable de la Tierra y un `pair_id` único por fila. Un `candidate_id` sí puede repetirse para emparejar el mismo análogo con distintos puntos terrestres; sus datos deben coincidir en todas esas filas.
- No agregues filas de notas ni encabezados intermedios al CSV: el cargador interpreta cada fila posterior al encabezado como un registro.
- `src/planetaryData.js` carga y valida ambos tipos de registros; los pares alimentan la similitud y los candidatos autónomos muestran sus factores sin comparación terrestre.
- **Un solo valor por sitio.** Cada candidato se mide una vez con las mismas fuentes que la búsqueda (LOLA, MOLA, TES, MCD, mapas geológicos) y su pareja copia esos valores, así que la fila del candidato y la de la pareja muestran el mismo número. `candidate_factor_metadata_json` guarda la fuente y el método de cada factor (`kind`: `pipeline_measured` o `pipeline_derived`) y, como referencia, el valor del backend (`backend_value`), que analiza un entorno de 30 km y puede diferir. Si un factor no se mide (el suelo de Marte o del polo lunar), la fila del candidato lo deja vacío y la pareja pone el centro del rango del simulador, que la app marca como *Demo*. El veredicto del backend (puntaje global, grupos y filtros) se conserva tal cual.
- Las parejas Tierra–análogo tienen `data_status=medido_parcial`, con la fuente de cada valor en `public/data/site_values.json`. Las 13 parejas elegidas a mano que había antes están en `pipeline/known_analogs.json` y sirven para validar la búsqueda (`public/data/validation.json`).
- `public/data/parameter_model.json` define el modelo: ruta del CSV (`dataset`), grupos, subparámetros (con sus columnas del CSV, `span` y rangos del simulador), y por cuerpo su objetivo, los pesos de los grupos y el requisito del sitio. `src/parameterModel.js` lo carga y valida al iniciar; `src/similarity.js` solo contiene las fórmulas. Para cambiar un peso, un umbral o añadir un subparámetro se edita el JSON (y el CSV si hacen falta columnas nuevas), no el código. `src/earthSites.js` mantiene únicamente los nombres de capas y las rutas de imágenes del panel.
- Las imágenes recortadas del panel NASA siguen siendo recursos aparte; agregarlas no es necesario para que aparezcan los marcadores ni para calcular similitudes.

Luego abre la URL que muestra la terminal (por defecto `http://localhost:5173`).

## Datos reales (pipeline)

`pipeline/` descarga solo la ventana de cada sitio desde las fuentes abiertas (LOLA, MOLA, COP-DEM, Mars Climate Database, MODIS, mapas geológicos) y escribe `public/data/site_values.json` con cada valor y su fuente. Ver [`pipeline/README.md`](pipeline/README.md). El orden para regenerar todo:

```bash
python -m pipeline earth-geology   # litología de la Tierra en la malla (una vez)
python -m pipeline candidates      # candidatos del backend -> filas candidate_only del CSV
python -m pipeline targets         # objetivos de la búsqueda
python -m pipeline search          # análogos en la Tierra -> public/data/earth_candidates.json
python -m pipeline validation      # puesto de los análogos conocidos -> public/data/validation.json
python -m pipeline pairs           # una pareja por candidato con su mejor análogo
```

## Estructura

```text
src/
├── main.js             # Arranque y escena principal: carrusel, selección y modo comparación
├── globe/              # Globo: texturas (carga sin bloquear), cuerpos, marcadores y fondo
├── keyboard.js         # Teclado centralizado por capas (globo, guía, laboratorio)
├── noise.js            # Ruido procedural compartido (value noise + fBm)
├── planetaryData.js    # Carga de ubicaciones y valores desde el CSV
├── parameterModel.js   # Carga y validación del modelo de parámetros (JSON)
├── similarity.js       # Fórmulas de similitud, grupos y requisitos
├── similarityPanel.js  # HUD de similitud
├── paramInfo.js        # Textos explicativos de cada parámetro
├── paramGuide.js       # Guía de parámetros y simulador
├── startScreen.js      # Pantalla de inicio con progreso de carga
├── lab/                # Laboratorio 3D (se descarga al abrirlo): terreno, configuración,
│   └── rover/          #   menú de rovers y, en rover/, modelos, conducción y parche de detalle
├── trekSites.js        # Capas, imágenes y enlaces a NASA Trek
├── earthSites.js       # Capas y rutas de imágenes terrestres del panel
├── comparePanel.js     # Panel inferior Tierra | análogo con imágenes reales
├── icons.js            # Íconos SVG compartidos
└── style.css
public/textures/        # Texturas de la Tierra y estrellas (+ respaldo de Marte y la Luna)
public/textures/trek/   # Mosaicos globales y máscara PSR descargados de NASA Trek
public/trek/sites/      # Recortes de imagen y relieve de cada sitio objetivo
public/data/            # Modelo de parámetros y parejas Tierra–análogo/candidatos autónomos (CSV)
scripts/fetch-trek.sh   # Descarga y ensambla las capas de Trek (Marte, Luna) y GIBS (Tierra)
backend/                # Proceso batch independiente para candidatos lunares y marcianos
pipeline/               # Datos reales: mediciones, búsqueda global, geología, validación
docs/                   # Fichas de los análogos destacados
```

## Controles

| Acción | Control |
|---|---|
| Rotar / zoom | Arrastrar / rueda del mouse |
| Seleccionar punto o cuerpo | Clic |
| Girar un cuerpo (modo comparación) | Arrastrar sobre él |
| Punto anterior / siguiente | `←` `→` o ‹ › en el HUD |
| Salir de la comparación o cerrar ventanas | `Esc` |
| Ocultar paneles del laboratorio | `H` |
| Conducir el rover (laboratorio) | `W` `A` `S` `D` · `Shift` más rápido · `Espacio` frenar |
| Cámara del rover | Arrastrar / rueda · `C` vuelve detrás del rover |
| Cámara del rover sin mouse (touchpad) | Control circular arriba a la izquierda (solo con un rover): joystick para orbitar, `−` `+` zoom, `⌂` detrás del rover |
| Bajar del rover / cerrar el laboratorio | `Esc` (primero baja del rover, luego cierra) |

## Próximos pasos

- Asistente de IA que explique los resultados a partir de los valores calculados.

## Créditos

- Laboratorio 3D: MGS MOLA, LRO LOLA y LRO WAC, Viking MDIM 2.1 y THEMIS (USGS Astrogeology); Copernicus DEM GLO-30 (ESA); Sentinel-2 cloudless 2020 de [EOX IT Services](https://s2maps.eu) (CC BY-NC-SA 4.0, datos Copernicus Sentinel modificados).
- Imágenes de la Tierra en el panel de comparación: [NASA GIBS](https://gibs.earthdata.nasa.gov/) (Blue Marble Next Generation, ASTER GDEM).
- Imágenes de Marte y la Luna: [NASA Solar System Treks](https://trek.nasa.gov/) (NASA/JPL-Caltech). Capas: Viking MDIM 2.1, MGS MOLA, LRO WAC y LRO LOLA (incluida la de sombra permanente del polo sur).
- Texturas de la Tierra y de respaldo: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), basadas en datos de la NASA.
- Geología: [GLiM](https://doi.pangaea.de/10.1594/PANGAEA.788537) (Hartmann y Moosdorf 2012), [Unified Geologic Map of the Moon](https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020) (Fortezzo, Spudis y Harrel 2020, USGS) y [Geologic Map of Mars, SIM 3292](https://pubs.usgs.gov/publication/sim3292) (Tanaka et al. 2014, USGS). Nombres de lugares de la Luna y Marte: [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) (IAU WGPSN / USGS).
- Proyecto desarrollado para el NASA Space Apps Challenge 2026 (reto *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*).

## Imágenes de las parejas (NASA Trek y GIBS)

Las imágenes del panel "Vista real" se descargan una vez y se sirven desde `public/trek/sites/`, para que la demo no dependa de que NASA responda. Hay un recorte de imagen y otro de relieve por cada lado de cada pareja del CSV:

```bash
python3 scripts/fetch_pair_images.py            # solo las que faltan (requiere numpy y Pillow)
python3 scripts/fetch_pair_images.py --force    # las regenera todas
```

Si cambia el CSV (otras parejas), basta con volver a ejecutarlo. Las teselas crudas quedan en `.trek-cache/` (ignorado por git). `scripts/fetch-trek.sh` sigue generando las texturas globales de los globos.
