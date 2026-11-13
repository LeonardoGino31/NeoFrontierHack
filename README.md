# NeoFrontier

Plataforma interactiva para encontrar y comparar **análogos terrestres** de regiones de Marte y la Luna, construida con Three.js.

## Funcionalidades

- **Globo 3D** de la Tierra, Marte y la Luna con texturas reales, atmósfera, nubes y luces nocturnas.
- **Puntos de análisis** sobre la Tierra: al seleccionar uno, se muestra lado a lado con su análogo en Marte o la Luna.
- **HUD de similitud** con 7 parámetros (elevación, pendiente, temperatura, rugosidad, albedo, óxidos de hierro y potencial de hielo) y un índice global ponderado.
- **Guía de parámetros**: explica qué mide cada parámetro, por qué importa, qué datasets se usarán y cómo se calcula, con un simulador interactivo.
- **Imágenes reales de NASA Trek**: Marte y la Luna usan mosaicos de [Mars Trek](https://trek.nasa.gov/mars/) y [Moon Trek](https://trek.nasa.gov/moon/) (Viking MDIM 2.1, LRO WAC). Los análogos son 9 sitios objetivo reales (Jezero, Gale, Meridiani, Arsia Mons, Utopia, Colinas de Marius, Aristarco, pozo de Tranquilidad y el polo sur con Shackleton) con recorte de imagen y relieve (MOLA / LOLA).
- **Comparación Tierra | análogo**: cada punto de la Tierra es un análogo conocido (Lago Salda, Pampas de La Joya en Perú, Río Tinto, Lanzarote, McMurdo…) emparejado con su sitio. El panel inferior muestra ambos con imagen y relieve reales al **mismo ancho en km** (Tierra: Blue Marble NG y ASTER GDEM de [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api)), y explica dónde falla la analogía.
- **Navegación**: botones Marte / Luna para cambiar de cuerpo, flechas ‹ › (o ← →) para recorrer sus puntos, y arrastre de cada cuerpo por separado en el modo comparación.
- **Sombra permanente del polo sur lunar**: capa de LRO LOLA con las regiones donde nunca da el sol (posible hielo), activable al ver la Luna.
- **Laboratorio 3D**: terreno procedural de 20 × 20 km donde cada parámetro se visualiza sobre el relieve y se puede modificar en vivo.

> ⚠️ Estado actual: los sitios, sus pares en la Tierra y las imágenes son reales; los valores de similitud, la confianza del potencial de hielo y los entornos del laboratorio siguen siendo **de demostración**. La humedad relativa ya no forma parte del conjunto de parámetros. Las fórmulas de similitud son las definitivas; los datos reales se integrarán desde el backend.

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

Las imágenes ya están en `public/`. Para regenerarlas (o tras añadir un sitio en `src/trekSites.js` / `src/earthSites.js` y en la lista del script):

```bash
./scripts/fetch-trek.sh          # descarga solo lo que falta
FORCE=1 ./scripts/fetch-trek.sh  # vuelve a descargar todo
```

Requiere `curl`, ImageMagick 7 (`magick`) y `python3` con `numpy` y `Pillow` (solo para la vista polar). Las tiles crudas quedan en `.trek-cache/`, que no se versiona. Usa los servicios WMTS públicos de Trek (`https://trek.nasa.gov/tiles/...`) y GIBS (`https://gibs.earthdata.nasa.gov/wmts/...`).

Luego abre la URL que muestra la terminal (por defecto `http://localhost:5173`).

## Estructura

```text
src/
├── main.js             # Escena principal: globo, selección y modo comparación
├── similarity.js       # Parámetros y cálculo de similitud
├── similarityPanel.js  # HUD de similitud
├── paramInfo.js        # Textos explicativos de cada parámetro
├── paramGuide.js       # Guía de parámetros y simulador
├── terrainLab.js       # Laboratorio de terreno 3D
├── trekSites.js        # Sitios objetivo en Marte y la Luna (textos y coordenadas)
├── earthSites.js       # Puntos de la Tierra emparejados con cada sitio (y dónde falla la analogía)
├── comparePanel.js     # Panel inferior Tierra | análogo con imágenes reales
├── icons.js            # Íconos SVG compartidos
└── style.css
public/textures/        # Texturas de la Tierra y estrellas (+ respaldo de Marte y la Luna)
public/textures/trek/   # Mosaicos globales y máscara PSR descargados de NASA Trek
public/trek/sites/      # Recortes de imagen y relieve de cada sitio objetivo
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
