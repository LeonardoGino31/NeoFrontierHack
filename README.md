# NeoFrontier

Plataforma interactiva para encontrar y comparar **análogos terrestres** de regiones de Marte y la Luna, construida con Three.js.

## Funcionalidades

- **Globo 3D** de la Tierra, Marte y la Luna con texturas reales, atmósfera, nubes y luces nocturnas.
- **Puntos de análisis** sobre la Tierra: al seleccionar uno, se muestra lado a lado con su análogo en Marte o la Luna.
- **HUD de similitud** con 3 grupos comparados (iluminación, topografía y potencial de hielo) y un requisito del sitio según el objetivo de cada cuerpo: **Luna = estación base** (comunicación con la Tierra) y **Marte = aterrizaje y recorridos** (densidad del aire para el descenso).
- **Guía de parámetros**: explica qué mide cada parámetro, por qué importa, qué datasets se usarán y cómo se calcula, con un simulador interactivo.
- **Imágenes reales de NASA Trek**: Marte y la Luna usan mosaicos de [Mars Trek](https://trek.nasa.gov/mars/) y [Moon Trek](https://trek.nasa.gov/moon/) (Viking MDIM 2.1, LRO WAC). Los análogos son 9 sitios objetivo reales (Jezero, Gale, Meridiani, Arsia Mons, Utopia, Colinas de Marius, Aristarco, pozo de Tranquilidad y el polo sur con Shackleton) con recorte de imagen y relieve (MOLA / LOLA).
- **Comparación Tierra | análogo**: cada punto de la Tierra es un análogo conocido (Lago Salda, Pampas de La Joya en Perú, Río Tinto, Lanzarote, McMurdo…) emparejado con su sitio. El panel inferior muestra ambos con imagen y relieve reales al **mismo ancho en km** (Tierra: Blue Marble NG y ASTER GDEM de [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)), y explica dónde falla la analogía.
- **Navegación**: botones Marte / Luna para cambiar de cuerpo, flechas ‹ › (o ← →) para recorrer sus puntos, y arrastre de cada cuerpo por separado en el modo comparación.
- **Sombra permanente del polo sur lunar**: capa de LRO LOLA con las regiones donde nunca da el sol (posible hielo), activable al ver la Luna.
- **Laboratorio 3D**: terreno procedural de 20 × 20 km donde cada parámetro se visualiza sobre el relieve y se puede modificar en vivo.
- **Rovers en el laboratorio**: Perseverance, Sojourner (Marte), Apollo LRV y Yutu-2 (Luna) modelados en 3D a escala real, con ruedas que giran y se orientan y suspensión que copia el suelo; se conducen sobre el terreno que se haya ajustado.
- **Backend experimental de sitios**: proceso Python separado para priorizar ubicaciones aproximadas en Luna y Marte desde DEM científicos y capas raster opcionales. Exporta candidatos con coordenadas y métricas a GeoJSON, sin intervenir en el CSV Tierra–análogo.

> ⚠️ Estado actual: los sitios, sus pares en la Tierra y las imágenes son reales; los valores de similitud, la confianza del potencial de hielo y los índices del laboratorio siguen siendo **de demostración**. La metodología de abajo es una propuesta; debe definirse y validarse antes de sustituir los valores de demostración.

## Criterios para calcular los porcentajes

La guía de parámetros explica qué significa cada indicador y enumera fuentes posibles. Esta sección detalla qué observaciones se deberían usar. **Todavía no se calculan con datos reales.**

### Objetivo de cada cuerpo

| Cuerpo | Objetivo | Peso de los grupos | Requisito del sitio |
|---|---|---|---|
| Luna | Estación base permanente | Iluminación ×1.5 · Topografía ×1 · Hielo ×1.5 | Comunicación con la Tierra ≥ 50 % del tiempo |
| Marte | Aterrizaje y recorridos de rover | Iluminación ×0.5 · Topografía ×2 · Hielo ×1 | Densidad del aire ≥ 0.018 kg/m³ (≈ aterrizar por debajo de +1 km) |

### Parámetros comparados (Tierra – análogo)

Cada subparámetro se compara con `100 × max(0, 1 − |Tierra − análogo| / span)`. Un grupo es el promedio de sus subparámetros y el índice global es el promedio de los grupos con los pesos del cuerpo.

| Grupo | Subparámetro | Datos que se considerarían | Valor |
|---|---|---|---|
| Iluminación | Tiempo con luz solar | NASA POWER (Tierra), modelos con MOLA (Marte), mapas de iluminación de LOLA (Luna); con sombras del relieve. | % del tiempo con sol directo |
| Iluminación | Albedo | MODIS MCD43 (Tierra), TES (Marte), LROC / Clementine (Luna). | Reflectancia 0–1 |
| Topografía | Desnivel | DEM: Copernicus GLO-30 / SRTM, MOLA, LOLA. Se compara el desnivel dentro del recorte, no la altitud absoluta. | m |
| Topografía | Pendiente segura | Pendiente derivada del DEM a escala del aterrizador o del rover. | % del área bajo 15° |
| Topografía | Libre de cráteres y rocas | Catálogos de cráteres (Robbins), CTX / HiRISE, LROC NAC; rugosidad del DEM. Une cráteres y rugosidad para no contarlos dos veces. | % del área sin obstáculos |
| Topografía | Estabilidad del suelo | Inercia térmica (THEMIS / TES, Diviner, ASTER) o densidad del suelo (SoilGrids). Es una **estimación**. | Índice 0–100 |
| Hielo | Potencial de hielo | Permafrost ESA CCI y nieve MODIS (Tierra), Mars Odyssey / SHARAD / SWIM (Marte), Diviner / LEND / LAMP (Luna). | Índice 0–100, con **confianza** aparte |

### Requisitos del sitio (no se comparan con la Tierra)

La Tierra no puede reproducir el horizonte lunar ni la atmósfera marciana, así que estos valores solo se miden en el sitio y funcionan como **filtro**: un sitio que no cumple se marca como *no apto*, aunque su análogo se parezca mucho.

| Cuerpo | Requisito | Datos | Valor demo actual |
|---|---|---|---|
| Luna | Comunicación con la Tierra | Mapas de visibilidad de la Tierra de LRO LOLA. | Cara visible = 100 %; sitios polares, valores ilustrativos |
| Marte | Densidad del aire en superficie | Mars Climate Database / MCS. | Estimada con la elevación MOLA aproximada: `0.020 × e^(−h / 11.1 km)` |

### Reglas para el índice global

- Los requisitos del sitio son **filtros obligatorios**; una buena similitud no compensa un riesgo de aterrizaje o la falta de enlace con la Tierra.
- Evitar doble conteo: cráteres y rocas forman un solo subparámetro; la pendiente se mide aparte.
- Mostrar la confianza del dato por separado del valor, especialmente para el hielo.
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

- `public/data/planetary_candidates.csv` es la fuente de ambas ubicaciones y de los valores usados para calcular la similitud. Cada fila representa una pareja completa Tierra–análogo.
- El encabezado del CSV sigue este orden de bloques:

  1. **Identificadores:** `pair_id`, `earth_site_id`, `candidate_id`, `body`.
  2. **Sitio terrestre:** `earth_site_name`, `earth_region`, `earth_latitude`, `earth_longitude`, `earth_kind`, `earth_description`, `earth_limits`.
  3. **Análogo lunar o marciano:** `analog_site_name`, `analog_latitude`, `analog_longitude`, `footprint_km`, `analog_kind`, `analog_description`, `analog_polar`.
  4. **Estado del registro:** `data_status`.
  5. **Valores comparados**, en este orden: `sunlight_earth`, `sunlight_analog`; `albedo_earth`, `albedo_analog`; `relief_earth`, `relief_analog`; `safe_slope_earth`, `safe_slope_analog`; `crater_free_earth`, `crater_free_analog`; `soil_stability_earth`, `soil_stability_analog`; `ice_earth`, `ice_analog`; `ice_confidence_earth`, `ice_confidence_analog`. La confianza del hielo se muestra aparte y no se incluye en el índice.
  6. **Requisito del sitio** (solo del análogo): `earth_view_analog` (% del tiempo, solo Luna) y `descent_density_analog` (kg/m³, solo Marte). La columna que no aplica al cuerpo se deja vacía.
- Para agregar una pareja, añade una fila de datos debajo del encabezado, respetando ese orden y con un `pair_id` y un `earth_site_id` únicos. `body` debe ser `mars` o `moon`; incluye las coordenadas de ambos puntos y valores numéricos para los parámetros aplicables.
- `earth_latitude` / `earth_longitude` posicionan el punto seleccionable en la Tierra. `analog_latitude` / `analog_longitude` posicionan su contraparte en Marte o la Luna. Al seleccionar el punto, el índice y los porcentajes se calculan con los valores de esa fila.
- Usa un `earth_site_id` único por punto seleccionable de la Tierra y un `pair_id` único por fila. Un `candidate_id` sí puede repetirse para emparejar el mismo análogo con distintos puntos terrestres; sus datos deben coincidir en todas esas filas.
- No agregues filas de notas ni encabezados intermedios al CSV: el cargador interpreta cada fila posterior al encabezado como un registro.
- `src/planetaryData.js` carga y valida el CSV, crea las parejas para los marcadores y entrega los valores al cálculo de similitud.
- Los valores actuales tienen `data_status=demo_fijo`: son valores de demostración fijos, no mediciones ni resultados científicos. La densidad de Marte se estimó con la elevación MOLA aproximada de cada sitio y la visibilidad de la Tierra de los sitios polares es ilustrativa. La confianza del potencial de hielo permanece en columnas separadas y no entra al índice.
- `public/data/parameter_model.json` define el modelo: ruta del CSV (`dataset`), grupos, subparámetros (con sus columnas del CSV, `span` y rangos del simulador), y por cuerpo su objetivo, los pesos de los grupos y el requisito del sitio. `src/parameterModel.js` lo carga y valida al iniciar; `src/similarity.js` solo contiene las fórmulas. Para cambiar un peso, un umbral o añadir un subparámetro se edita el JSON (y el CSV si hacen falta columnas nuevas), no el código. `src/earthSites.js` mantiene únicamente los nombres de capas y las rutas de imágenes del panel.
- Las imágenes recortadas del panel NASA siguen siendo recursos aparte; agregarlas no es necesario para que aparezcan los marcadores ni para calcular similitudes.

Luego abre la URL que muestra la terminal (por defecto `http://localhost:5173`).

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
public/data/            # Modelo de parámetros (JSON) y parejas Tierra–análogo con sus valores (CSV)
scripts/fetch-trek.sh   # Descarga y ensambla las capas de Trek (Marte, Luna) y GIBS (Tierra)
backend/                # Proceso batch independiente para candidatos lunares y marcianos
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

- Recortes de DEM reales (MOLA, LOLA, Copernicus) en el laboratorio.
- Asistente de IA que explique los resultados a partir de los valores calculados.

## Créditos

- Imágenes de la Tierra en el panel de comparación: [NASA GIBS](https://gibs.earthdata.nasa.gov/) (Blue Marble Next Generation, ASTER GDEM).
- Imágenes de Marte y la Luna: [NASA Solar System Treks](https://trek.nasa.gov/) (NASA/JPL-Caltech). Capas: Viking MDIM 2.1, MGS MOLA, LRO WAC y LRO LOLA (incluida la de sombra permanente del polo sur).
- Texturas de la Tierra y de respaldo: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), basadas en datos de la NASA.
- Proyecto desarrollado para el hackathon Terra2Mars.
