# NeoFrontier

Plataforma interactiva para encontrar y comparar **análogos terrestres** de regiones de Marte y la Luna, construida con Three.js.

## Funcionalidades

- **Globo 3D** de la Tierra, Marte y la Luna con texturas reales, atmósfera, nubes y luces nocturnas.
- **Puntos de análisis** sobre la Tierra: al seleccionar uno, se muestra lado a lado con su análogo en Marte o la Luna.
- **HUD de similitud** con criterios geográficos, ambientales y operativos: elevación, pendiente, temperatura, rugosidad, albedo, óxidos de hierro, potencial de hielo, obstáculos, estabilidad del suelo, acceso a objetivos y energía solar. El criterio atmosférico de EDL se muestra solo para Marte.
- **Guía de parámetros**: explica qué mide cada parámetro, por qué importa, qué datasets se usarán y cómo se calcula, con un simulador interactivo.
- **Imágenes reales de NASA Trek**: Marte y la Luna usan mosaicos de [Mars Trek](https://trek.nasa.gov/mars/) y [Moon Trek](https://trek.nasa.gov/moon/) (Viking MDIM 2.1, LRO WAC). Los análogos son 9 sitios objetivo reales (Jezero, Gale, Meridiani, Arsia Mons, Utopia, Colinas de Marius, Aristarco, pozo de Tranquilidad y el polo sur con Shackleton) con recorte de imagen y relieve (MOLA / LOLA).
- **Comparación Tierra | análogo**: cada punto de la Tierra es un análogo conocido (Lago Salda, Pampas de La Joya en Perú, Río Tinto, Lanzarote, McMurdo…) emparejado con su sitio. El panel inferior muestra ambos con imagen y relieve reales al **mismo ancho en km** (Tierra: Blue Marble NG y ASTER GDEM de [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)), y explica dónde falla la analogía.
- **Navegación**: botones Marte / Luna para cambiar de cuerpo, flechas ‹ › (o ← →) para recorrer sus puntos, y arrastre de cada cuerpo por separado en el modo comparación.
- **Sombra permanente del polo sur lunar**: capa de LRO LOLA con las regiones donde nunca da el sol (posible hielo), activable al ver la Luna.
- **Laboratorio 3D**: terreno procedural de 20 × 20 km donde cada parámetro se visualiza sobre el relieve y se puede modificar en vivo.

> ⚠️ Estado actual: los sitios, sus pares en la Tierra y las imágenes son reales; los valores de similitud, la confianza del potencial de hielo y los índices operativos del laboratorio siguen siendo **de demostración**. La humedad relativa ya no forma parte del conjunto de parámetros. La metodología de abajo es una propuesta; debe definirse y validarse antes de sustituir los valores de demostración.

## Criterios para calcular los porcentajes

La guía de parámetros explica qué significa cada indicador y enumera fuentes posibles. Esta tabla detalla qué observaciones se deberían usar para estimar su porcentaje. **Todavía no se calculan con datos reales.**

Hay dos porcentajes distintos:

- **Similitud:** cuánto se parecen los valores de la Tierra y del sitio extraterrestre. Para datos comparables, la fórmula actual es `100 × max(0, 1 − |Tierra − análogo| / span)`.
- **Idoneidad operativa:** qué fracción de superficie, tiempo o rutas cumple los requisitos de una misión rover definida. No se debe interpretar como similitud geológica.

| Parámetro | Datos que se considerarían | Cómo obtener el porcentaje |
|---|---|---|
| Elevación | Altitud respecto al areoide de Marte o la referencia lunar, con DEM (MOLA o LOLA). | Fracción de la zona dentro del intervalo de elevación permitido por el sistema de aterrizaje. |
| Pendiente | Pendiente derivada del DEM a la escala del aterrizador y del rover. | Porcentaje de celdas de aterrizaje o ruta que están bajo el límite de pendiente definido para la misión. |
| Temperatura | Mínimas y máximas por ciclo día-noche y por estación; límites térmicos del rover. | Porcentaje del tiempo operativo dentro del rango térmico admitido. La media sola no basta. |
| Rugosidad | Variación del relieve a escalas de ruedas, rover y ruta, derivada de DEM o imágenes estereoscópicas. | Porcentaje de la superficie o ruta bajo el umbral de rugosidad del vehículo. |
| Albedo | Reflectancia de la superficie; datos espectrales, por ejemplo MODIS en la Tierra, TES en Marte y LROC/Clementine en la Luna. | Para analogía, porcentaje de similitud respecto al análogo. Para energía, el albedo es una entrada térmica, no una medida de iluminación solar. |
| Óxidos de hierro | Abundancia mineral, como FeO, estimada por espectrometría o datos geoquímicos. | Porcentaje de similitud geológica respecto al objetivo de estudio; por sí solo no mide seguridad de aterrizaje. |
| Potencial de hielo | Evidencia orbital o de superficie, estabilidad térmica, sombra, profundidad y accesibilidad estimadas. | Índice de potencial separado del **nivel de confianza**. La confianza depende de cobertura, resolución y corroboración entre instrumentos; no equivale a la cantidad de hielo. |
| Área libre de obstáculos | Distribución y tamaño de rocas, cráteres, dunas y otros peligros dentro de la elipse de aterrizaje. | Área que pasa los límites de seguridad dividida por el área total evaluada. |
| Estabilidad del suelo | Capacidad portante, cohesión, granulometría, polvo, tracción y hundimiento esperado de las ruedas. | Índice normalizado de firmeza y movilidad según los requisitos del rover. Evitar contar de nuevo los obstáculos ya incluidos en el área de aterrizaje. |
| Condiciones de descenso (EDL) | Perfiles de presión/densidad, viento y polvo atmosférico para la ubicación, estación y hora previstas. | Porcentaje de escenarios modelados que quedan dentro de los márgenes del sistema EDL. Aplica a Marte; depende del diseño de la misión. |
| Acceso a objetivos científicos | Distancia y rutas a los objetivos, pendientes, obstáculos y energía necesaria para recorrerlas. | Objetivos alcanzables dentro del radio y presupuesto de misión dividido por el total de objetivos evaluados. |
| Energía solar disponible | Iluminación integrada en el tiempo, sombras, estación, orientación y demanda energética del rover. | Energía solar estimada dividida por la demanda del rover durante el periodo evaluado, expresada como porcentaje. Solo aplica a rovers con paneles solares. |

### Reglas para el índice global

- Usar límites de seguridad como **filtros obligatorios** antes de ordenar los sitios; una buena similitud no debe compensar un riesgo de aterrizaje.
- Evitar doble conteo: pendiente, rugosidad y rocas también influyen en el área segura y la transitabilidad. Cada observación debe aportar a un solo criterio compuesto o tener su peso justificado.
- Mostrar la confianza del dato por separado del valor del parámetro, especialmente para el hielo.
- Definir el tipo de rover, sus límites operativos, la temporada de llegada y la fuente de energía antes de fijar umbrales y pesos.

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

### Datos de ubicaciones y similitud

- `public/data/planetary_candidates.csv` es la fuente de ambas ubicaciones y de los valores usados para calcular la similitud. Cada fila representa una pareja completa Tierra–análogo.
- Para agregar una pareja, añade una fila con un `pair_id` único; los datos del sitio terrestre (`earth_site_*`) y del candidato (`candidate_id`, `body`, `analog_*`); y los valores de cada parámetro en columnas `*_earth` y `*_analog`. Las columnas de EDL pueden quedar vacías para la Luna. `body` debe ser `mars` o `moon`.
- `earth_latitude` / `earth_longitude` posicionan el punto seleccionable en la Tierra. `analog_latitude` / `analog_longitude` posicionan su contraparte en Marte o la Luna. Al seleccionar el punto, el índice y los porcentajes se calculan con los valores de esa fila.
- Usa un `earth_site_id` único por punto seleccionable de la Tierra y un `pair_id` único por fila. Un `candidate_id` sí puede repetirse para emparejar el mismo análogo con distintos puntos terrestres; sus datos deben coincidir en todas esas filas.
- `src/planetaryData.js` carga y valida el CSV, crea las parejas para los marcadores y entrega los valores al cálculo de similitud.
- Los valores actuales tienen `data_status=demo_fijo`: son valores de demostración fijos generados dentro de los rangos anteriores, no mediciones ni resultados científicos. La confianza del potencial de hielo permanece en columnas separadas y no entra al índice.
- Los rangos y pesos de parámetros en `src/similarity.js` se conservan para el cálculo y el simulador de la guía. `src/earthSites.js` mantiene únicamente los nombres de capas y las rutas de imágenes del panel.
- Las imágenes recortadas del panel NASA siguen siendo recursos aparte; agregarlas no es necesario para que aparezcan los marcadores ni para calcular similitudes.

Luego abre la URL que muestra la terminal (por defecto `http://localhost:5173`).

## Estructura

```text
src/
├── main.js             # Escena principal: globo, selección y modo comparación
├── planetaryData.js    # Carga de ubicaciones y valores desde el CSV
├── similarity.js       # Parámetros y cálculo de similitud
├── similarityPanel.js  # HUD de similitud
├── paramInfo.js        # Textos explicativos de cada parámetro
├── paramGuide.js       # Guía de parámetros y simulador
├── terrainLab.js       # Laboratorio de terreno 3D
├── trekSites.js        # Capas, imágenes y enlaces a NASA Trek
├── earthSites.js       # Capas y rutas de imágenes terrestres del panel
├── comparePanel.js     # Panel inferior Tierra | análogo con imágenes reales
├── icons.js            # Íconos SVG compartidos
└── style.css
public/textures/        # Texturas de la Tierra y estrellas (+ respaldo de Marte y la Luna)
public/textures/trek/   # Mosaicos globales y máscara PSR descargados de NASA Trek
public/trek/sites/      # Recortes de imagen y relieve de cada sitio objetivo
public/data/            # Parejas Tierra–análogo y valores fijos para similitud (CSV)
scripts/fetch-trek.sh   # Descarga y ensambla las capas de Trek (Marte, Luna) y GIBS (Tierra)
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

## Próximos pasos

- Backend con FastAPI, Pandas y scikit-learn para calcular la similitud con datos reales.
- Recortes de DEM reales (MOLA, LOLA, Copernicus) en el laboratorio.
- Asistente de IA que explique los resultados a partir de los valores calculados.

## Créditos

- Imágenes de la Tierra en el panel de comparación: [NASA GIBS](https://gibs.earthdata.nasa.gov/) (Blue Marble Next Generation, ASTER GDEM).
- Imágenes de Marte y la Luna: [NASA Solar System Treks](https://trek.nasa.gov/) (NASA/JPL-Caltech). Capas: Viking MDIM 2.1, MGS MOLA, LRO WAC y LRO LOLA (incluida la de sombra permanente del polo sur).
- Texturas de la Tierra y de respaldo: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), basadas en datos de la NASA.
- Proyecto desarrollado para el hackathon Terra2Mars.
