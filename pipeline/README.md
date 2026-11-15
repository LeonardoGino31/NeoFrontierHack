# Pipeline de datos

Mide los parámetros de cada sitio del CSV (`public/data/planetary_candidates.csv`) desde fuentes abiertas y escribe `public/data/site_values.json`, con cada valor, su estado y su fuente.

No descarga datasets completos: lee por HTTP solo la ventana de cada sitio (20 km en las parejas de Marte, 5 km en las de la Luna). Una ejecución completa transfiere unos 80 MB y tarda entre 5 y 20 minutos, según la respuesta de los servidores. Todo queda en `.data-cache/` (ignorado por git), así que repetirla es casi instantáneo.

## Instalación

Python 3.11 o superior. Las ruedas de `rasterio` ya incluyen GDAL.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements.txt
```

## Uso (desde la raíz del repo)

```bash
python -m pipeline fetch --no-appeears          # todos los sitios, sin MODIS
python -m pipeline fetch --sites jezero,salda   # solo esos sitios (conserva los demás en el JSON)
python -m pipeline apply                        # copia los valores medidos al CSV de la app
python -m unittest discover -s pipeline/tests -t .   # pruebas de los cálculos (sin red)
```

`apply` solo cambia las columnas que tienen dato real y marca la fila con `data_status=medido_parcial`. El resto conserva sus valores de demostración.

### Dónde se ve en la app

La app lee `site_values.json` junto al CSV. Un valor cuenta como real solo si el CSV tiene el mismo número que midió el pipeline (es decir, si se ejecutó `apply`).

- **Panel de similitud:** el pie dice cuántos valores de la pareja son reales, por ejemplo "5 de 15 valores con datos reales". Sin ninguno, dice "datos de demo".
- **Guía de parámetros**, en "En el punto seleccionado": cada valor lleva su etiqueta (Medido, Calculado, Estimado (modelo) o Demo) y, si es real, el dataset enlazado.

### MODIS (nieve en la Tierra)

Necesita una cuenta gratuita de [Earthdata](https://urs.earthdata.nasa.gov/) en dos variables de entorno (nunca en el repo):

```bash
export EARTHDATA_USERNAME=...
export EARTHDATA_PASSWORD=...
python -m pipeline fetch
```

La consulta a AppEEARS es asíncrona. Si no termina en 15 minutos, el id de la tarea queda en `.data-cache/appeears_task.json` y basta con volver a ejecutar más tarde. **Esta parte aún no se ha probado con credenciales reales.**

## Búsqueda de análogos en toda la Tierra

Es el objetivo del proyecto: para cada sitio de la Luna o Marte, medir sus parámetros y buscar las celdas de la Tierra con los números más parecidos.

```bash
python -m pipeline earth-topo        # 1. topografía de toda la Tierra (COP-DEM 90 m; ~1–2 h, reanudable)
python -m pipeline earth-modis       # 2. nieve, luz solar, albedo y suelo (MODIS; requiere Earthdata)
python -m pipeline earth-permafrost  # 3. permafrost (Obu et al.; ~110 MB); se suma al índice de hielo
python -m pipeline targets           # 4. objetivos: CSV + backend + oficiales + propuestas propias
python -m pipeline search            # 5. candidatos -> public/data/earth_candidates.json
```

La búsqueda se puede repartir en varias ejecuciones en paralelo con `--body moon|mars`, `--targets id1,id2` y `--out archivo.json`; la caché de ventanas se escribe de forma atómica, así que no se pisan.

**Malla de la Tierra.** Celdas de 0.05° (~5 km) con desnivel, % de pendiente segura y % sin obstáculos, a dos escalas para comparar con el mismo tamaño de píxel:

- fina (~90 m), para la Luna;
- gruesa (~460 m), para Marte, que se compara en bloques de 4 × 4 celdas (20 km).

MODIS agrega nieve (meses con nieve), luz solar con cielo despejado, albedo de onda corta y estabilidad del suelo (inercia térmica aparente). El permafrost viene de los mapas de probabilidad de Obu et al. (hemisferio norte y Antártida, 1 km). El índice de hielo de cada celda es el **mayor** entre nieve y permafrost: basta una de las dos formas de hielo, y así un desierto frío sin nieve pero con permafrost (Valles Secos de McMurdo) cuenta como helado, que es el análogo del hielo enterrado de Marte y la Luna. Todo queda en `.data-cache/earth/earth_grid.npz`.

**Objetivos** (`pipeline/targets.json`):

- análogos del CSV, incluidas las regiones Artemis III;
- **candidatos del backend** (`backend/`, rama `desarollo`): las filas `record_type=candidate_only` del CSV y los GeoJSON de `backend/data/outputs/`, hasta `backendCandidates.maxPerBody` por cuerpo (primero los que pasan los filtros, luego por puntaje). El backend responde *dónde ir* en la Luna o Marte; el pipeline busca *dónde entrenar en la Tierra* para cada uno. Cada objetivo guarda el veredicto del backend en `backend` (estado, elegible, puntaje). Si el backend no se ha ejecutado, este origen no aporta objetivos;
- 38 Exploration Zones de Marte y 4 sitios de aterrizaje (`targets_official.json`);
- **propuestas propias**: `moon_proposals.py` recorre todo el polo sur lunar (75°–90° S) en bloques de 5 km y elige los que tienen luz solar ≥ 70 %, Tierra visible ≥ 50 %, pendiente segura ≥ 70 % y sombra permanente a ≤ 10 km. La propuesta 1 cae a ~15 km de la cresta de Shackleton y las propuestas 2 y 3 junto a Malapert y Nobile Rim 1: el método encuentra las zonas de Artemis III sin que se las indiquemos.

**Convivencia con el backend.** El pipeline nunca escribe en las filas `candidate_only`: `fetch` no las mide como sitios y `apply` no las toca, para no mezclar sus valores con los del backend. A los candidatos los mide aparte, con las mismas fuentes que a la Tierra, al buscar sus análogos.

**Búsqueda.** Usa los mismos `span`, grupos y pesos de `parameter_model.json` y solo los parámetros medidos en ambos lados. El resultado guarda los 25 mejores candidatos por objetivo, separados al menos 150 km, y el puesto que obtienen los análogos conocidos del CSV, para comprobar el método. Si las mejores celdas se amontonan en pocas regiones (los análogos de un polo lunar caen casi todos en la Antártida), la búsqueda revisa más celdas hasta completar los 25.

**Credenciales de Earthdata.** Crea `~/.netrc` (permisos 600) con:

```
machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA
```

## Qué mide hoy

| Métrica | Tierra | Marte | Luna (cara visible) | Luna (polo sur) |
|---|---|---|---|---|
| Desnivel, pendiente segura | COP-DEM | MOLA 463 m | LOLA 118 m | LOLA 120 m |
| Luz solar | Día × cielo despejado (MODIS, malla) | Geometría, cielo despejado | 50 % (geometría) | Mapas LOLA (PGDA) |
| Albedo | Onda corta, cielo blanco (MODIS MCD43C3) | Bolométrico de TES (7.4 km) | LOLA 1064 nm (10 px/°) | LOLA 1064 nm polar (1 km) |
| Estabilidad del suelo | Inercia térmica aparente (MODIS) | — | Abundancia de rocas de Diviner (70° S–70° N) | — |
| Tierra visible | — | — | 100 % (geometría) | Mapas LOLA (PGDA) |
| Hielo | Nieve (MODIS) o permafrost (Obu et al.) | Hidrógeno de Mars Odyssey GRS | — | Sombra permanente (LOLA) |
| Densidad del aire | — | Mars Climate Database | — | — |

**Escalas comparables.** La estabilidad del suelo se escala a 0–100 con los percentiles 5 y 95 de cada cuerpo (inercia térmica aparente en la Tierra, abundancia de rocas en la Luna): ambos miden lo mismo (superficie compacta o rocosa = alta, polvo suelto = baja), pero el valor es relativo a su cuerpo. El albedo de LOLA es a 1064 nm, en el infrarrojo cercano, y da valores ~1.5–2 veces mayores que el visible: sesga los análogos lunares hacia superficies terrestres más claras. Se guarda tal cual, sin un factor de conversión inventado.

## Datos que faltan para encontrar análogos

Un parámetro solo entra en la búsqueda si está medido **en los dos lados**: en el objetivo (Luna o Marte) y en la malla de la Tierra. Hoy la búsqueda usa 7 de los 7 parámetros en la cara visible de la Luna, y 6 en el polo sur lunar y en Marte. En las 13 parejas del CSV, 182 de 195 valores son reales (antes, 140).

Lo que falta está en el catálogo de fuentes del backend (`backend/config/source_catalog.json`, rama `desarollo`) como pendiente de integrar; por eso el pipeline no lo descarga:

| Parámetro | Falta en | Fuente prevista por el backend |
|---|---|---|
| Estabilidad del suelo | Marte | Inercia térmica de TES (ASU) |
| Estabilidad del suelo | Luna polar (> 70°) | Sin fuente global; Diviner no cubre los polos |
| Hielo | Luna (2.º y 3.er indicador) | LEND; el *Ice Favorability Index* de USGS ya lo descarga el backend |
| Hielo | Marte (2.º indicador) | Consistencia de hielo de SWIM: sin ella, las llanuras con hielo enterrado (Arcadia, Utopia, Deuteronilus) salen sin hielo |
| Luz solar | Marte (polvo) | Mars Climate Database: hoy casi todo Marte da ~50 % |
| Sin obstáculos | Luna y Marte | Productos de peligros de LROC y CTX/HiRISE. Mientras tanto se usa el desnivel local del DEM, que se mide igual en la Tierra |

**Datos que el backend aún no tiene y el pipeline sí.** Densidad del aire de la Mars Climate Database (el backend usa una fórmula por elevación), luz solar y hielo de Marte, y la malla de la Tierra. El requisito de Marte en `parameter_model.json` es 0.010 kg/m³ porque así lo cumplen Jezero, Gale y Meridiani con los valores de la MCD. El backend lee ese mismo número con su fórmula, que da valores más altos, así que con 0.010 filtra menos; conviene que pase a usar la MCD.

**Otros detalles del lado del objetivo:**

- **Hielo de Marte.** GRS mide los primeros ~50 cm en celdas de 5° y solo cubre de ~55° S a ~55° N. Dentro de esa franja el agua viene de minerales hidratados (máximo en el ecuador), así que el indicador solo es positivo en la región polar que GRS excluye, o con ≥ 10 % de agua. Por eso los objetivos actuales de Marte salen sin hielo.
- **Confianza del hielo.** Es la fracción de indicadores medidos: 33 % en la Luna (1 de 3), 50 % en Marte (1 de 2) y en la Tierra 100 % donde hay mapa de permafrost (nieve y permafrost) o 50 % fuera de él.

## Estructura

```text
pipeline/
├── config.json      # ventanas, umbrales y URLs de cada fuente (sin datos en el código)
├── __main__.py      # comandos fetch y apply
├── sites.py         # sitios leídos del CSV de la app (omite las filas del backend)
├── targets.py       # objetivos de la búsqueda (CSV, backend, oficiales, propuestas)
├── search.py        # puntúa la Tierra para cada objetivo
├── raster.py        # lectura de ventanas remotas, reproyección local y caché
├── metrics.py       # cálculos puros (desnivel, pendiente, luz, hielo)
├── collect.py       # qué fuente usa cada sitio
├── output.py        # site_values.json y volcado al CSV
├── earth/           # malla de la Tierra: topografía, MODIS y permafrost
├── sources/         # un módulo por proveedor (DEM, mapas lunares, albedo, Diviner, MCD, AppEEARS)
└── tests/
```
