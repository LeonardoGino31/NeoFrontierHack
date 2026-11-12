# Terra2Mars

Plataforma interactiva para encontrar y comparar **análogos terrestres** de regiones de Marte y la Luna, construida con Three.js.

## Funcionalidades

- **Globo 3D** de la Tierra, Marte y la Luna con texturas reales, atmósfera, nubes y luces nocturnas.
- **Puntos de análisis** sobre la Tierra: al seleccionar uno, se muestra lado a lado con su análogo en Marte o la Luna.
- **HUD de similitud** con 7 parámetros (elevación, pendiente, temperatura, rugosidad, albedo, óxidos de hierro y humedad) y un índice global ponderado.
- **Guía de parámetros**: explica qué mide cada parámetro, por qué importa, qué datasets se usarán y cómo se calcula, con un simulador interactivo.
- **Laboratorio 3D**: terreno procedural de 20 × 20 km donde cada parámetro se visualiza sobre el relieve y se puede modificar en vivo.

> ⚠️ Estado actual: los valores de similitud y los entornos del laboratorio son **de demostración**. Las fórmulas de similitud son las definitivas; los datos reales se integrarán desde el backend.

## Tecnologías

- [Three.js](https://threejs.org/) — visualización 3D
- [Vite](https://vite.dev/) — servidor de desarrollo y build
- JavaScript (ES Modules), HTML y CSS

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

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
├── icons.js            # Íconos SVG compartidos
└── style.css
public/textures/        # Texturas de la Tierra, Marte, la Luna y estrellas
```

## Controles

| Acción | Control |
|---|---|
| Rotar / zoom | Arrastrar / rueda del mouse |
| Seleccionar punto o cuerpo | Clic |
| Salir de la comparación o cerrar ventanas | `Esc` |
| Ocultar paneles del laboratorio | `H` |

## Próximos pasos

- Backend con FastAPI, Pandas y scikit-learn para calcular la similitud con datos reales.
- Recortes de DEM reales (MOLA, LOLA, Copernicus) en el laboratorio.
- Asistente de IA que explique los resultados a partir de los valores calculados.

## Créditos

- Texturas planetarias: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), basadas en datos de la NASA.
- Proyecto desarrollado para el hackathon Terra2Mars.
