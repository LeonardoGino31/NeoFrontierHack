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
python -m pipeline earth-topo      # 1. topografía de toda la Tierra (COP-DEM 90 m; ~1–2 h, reanudable)
python -m pipeline earth-modis     # 2. hielo, luz solar y suelo de toda la Tierra (MODIS; requiere Earthdata)
python -m pipeline targets         # 3. objetivos: CSV + backend + oficiales + propuestas propias
python -m pipeline search          # 4. candidatos -> public/data/earth_candidates.json
```

**Malla de la Tierra.** Celdas de 0.05° (~5 km) con desnivel, % de pendiente segura y % sin obstáculos, a dos escalas para comparar con el mismo tamaño de píxel:

- fina (~90 m), para la Luna;
- gruesa (~460 m), para Marte, que se compara en bloques de 4 × 4 celdas (20 km).

MODIS agrega hielo (meses con nieve), luz solar con cielo despejado y estabilidad del suelo (inercia térmica aparente). Todo queda en `.data-cache/earth/earth_grid.npz`.

**Objetivos** (`pipeline/targets.json`):

- análogos del CSV, incluidas las regiones Artemis III;
- **candidatos del backend** (`backend/`, rama `desarollo`): las filas `record_type=candidate_only` del CSV y los GeoJSON de `backend/data/outputs/`, hasta `backendCandidates.maxPerBody` por cuerpo (primero los que pasan los filtros, luego por puntaje). El backend responde *dónde ir* en la Luna o Marte; el pipeline busca *dónde entrenar en la Tierra* para cada uno. Cada objetivo guarda el veredicto del backend en `backend` (estado, elegible, puntaje). Si el backend no se ha ejecutado, este origen no aporta objetivos;
- 38 Exploration Zones de Marte y 4 sitios de aterrizaje (`targets_official.json`);
- **propuestas propias**: `moon_proposals.py` recorre todo el polo sur lunar (75°–90° S) en bloques de 5 km y elige los que tienen luz solar ≥ 70 %, Tierra visible ≥ 50 %, pendiente segura ≥ 70 % y sombra permanente a ≤ 10 km. La propuesta 1 cae a ~15 km de la cresta de Shackleton y las propuestas 2 y 3 junto a Malapert y Nobile Rim 1: el método encuentra las zonas de Artemis III sin que se las indiquemos.

**Convivencia con el backend.** El pipeline nunca escribe en las filas `candidate_only`: `fetch` no las mide como sitios y `apply` no las toca, para no mezclar sus valores con los del backend. A los candidatos los mide aparte, con las mismas fuentes que a la Tierra, al buscar sus análogos.

**Búsqueda.** Usa los mismos `span`, grupos y pesos de `parameter_model.json` y solo los parámetros medidos en ambos lados. El resultado guarda los 25 mejores candidatos por objetivo, separados al menos 150 km, y el puesto que obtienen los análogos conocidos del CSV, para comprobar el método.

**Credenciales de Earthdata.** Crea `~/.netrc` (permisos 600) con:

```
machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA
```

## Qué mide hoy

| Métrica | Tierra | Marte | Luna (cara visible) | Luna (polo sur) |
|---|---|---|---|---|
| Desnivel, pendiente segura | COP-DEM | MOLA 463 m | LOLA 118 m | LOLA 120 m |
| Luz solar | Día × cielo despejado (MODIS, malla) | Geometría, cielo despejado | 50 % (geometría) | Mapas LOLA (PGDA) |
| Tierra visible | — | — | 100 % (geometría) | Mapas LOLA (PGDA) |
| Hielo | Días de nieve (MODIS) | Hidrógeno de Mars Odyssey GRS | — | Sombra permanente (LOLA) |
| Densidad del aire | — | Mars Climate Database | — | — |

## Datos que faltan para encontrar análogos

Un parámetro solo entra en la búsqueda si está medido **en los dos lados**: en el objetivo (Luna o Marte) y en la malla de la Tierra. Hoy la búsqueda usa 5 de los 7 parámetros del modelo; ninguno de los dos que faltan (albedo y estabilidad del suelo) está medido en la Luna o Marte.

| Parámetro (grupo) | Tierra (malla) | Luna | Marte | Qué falta y fuente propuesta |
|---|---|---|---|---|
| Albedo (iluminación) | **falta** | **falta** | **falta** | Tierra: guardar el albedo de MCD43C3 como capa (ya se descarga para la inercia térmica). Luna: mosaico de reflectancia normalizada LROC WAC. Marte: albedo bolométrico de TES. |
| Estabilidad del suelo (topografía) | Inercia térmica aparente (MODIS) | **falta** | **falta** | Luna: abundancia de rocas y parámetro H de Diviner. Marte: inercia térmica de TES/THEMIS (Putzig y Mellon). Hay que fijar una escala común: la de la Tierra es aparente y se normaliza por percentiles. |
| Luz solar (iluminación) | Día × cielo despejado | Polo: LOLA. Resto: geometría | Geometría, sin polvo | Marte: descontar la opacidad del polvo (τ de la MCD). Hoy casi todo Marte da ~50 % y no distingue sitios. |
| Sin obstáculos (topografía) | Desnivel local del DEM | Desnivel local del DEM | Desnivel local del DEM | Es un sustituto. Faltan catálogos de cráteres (Robbins: Luna y Marte) y abundancia de rocas (Diviner, TES). |
| Hielo | Nieve (MODIS); **falta permafrost** | Solo sombra permanente (1 de 3 indicadores) | Solo GRS (1 de 2) | Tierra: permafrost de ESA CCI. Luna: temperatura máxima de Diviner y LEND, o el *Ice Favorability Index* de USGS que el backend ya descarga. Marte: consistencia de hielo de SWIM, sin la cual las llanuras con hielo enterrado (Arcadia, Utopia, Deuteronilus) salen sin hielo. |

Con lo que hay, la búsqueda distingue bien los sitios polares de la Luna (luz, hielo y relieve), pero en Marte casi solo compara relieve y pendiente: una llanura marciana se parece a cualquier desierto plano. Por eso el albedo y la estabilidad del suelo de Marte son lo más urgente.

**Datos que el backend aún no tiene y el pipeline sí.** Densidad del aire de la Mars Climate Database (el backend usa una fórmula por elevación), luz solar y hielo de Marte, y la malla de la Tierra. El requisito de Marte en `parameter_model.json` es 0.010 kg/m³ porque así lo cumplen Jezero, Gale y Meridiani con los valores de la MCD. El backend lee ese mismo número con su fórmula, que da valores más altos, así que con 0.010 filtra menos; conviene que pase a usar la MCD.

**Otros detalles del lado del objetivo:**

- **Hielo de Marte.** GRS mide los primeros ~50 cm en celdas de 5° y solo cubre de ~55° S a ~55° N. Dentro de esa franja el agua viene de minerales hidratados (máximo en el ecuador), así que el indicador solo es positivo en la región polar que GRS excluye, o con ≥ 10 % de agua. Por eso los objetivos actuales de Marte salen sin hielo.
- **Confianza del hielo.** Es la fracción de indicadores medidos: 33 % en la Luna (1 de 3) y 50 % en Marte (1 de 2).

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
├── sources/         # un módulo por proveedor (DEM, mapas lunares, MCD, AppEEARS)
└── tests/
```
