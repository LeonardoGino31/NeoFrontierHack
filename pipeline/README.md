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
python -m pipeline targets         # 3. objetivos: CSV + oficiales + propuestas propias
python -m pipeline search          # 4. candidatos -> public/data/earth_candidates.json
```

**Malla de la Tierra.** Celdas de 0.05° (~5 km) con desnivel, % de pendiente segura y % sin obstáculos, a dos escalas para comparar con el mismo tamaño de píxel:

- fina (~90 m), para la Luna;
- gruesa (~460 m), para Marte, que se compara en bloques de 4 × 4 celdas (20 km).

MODIS agrega hielo (meses con nieve), luz solar con cielo despejado y estabilidad del suelo (inercia térmica aparente). Todo queda en `.data-cache/earth/earth_grid.npz`.

**Objetivos** (`pipeline/targets.json`):

- análogos del CSV, incluidas las regiones Artemis III;
- 38 Exploration Zones de Marte y 4 sitios de aterrizaje (`targets_official.json`);
- **propuestas propias**: `moon_proposals.py` recorre todo el polo sur lunar (75°–90° S) en bloques de 5 km y elige los que tienen luz solar ≥ 70 %, Tierra visible ≥ 50 %, pendiente segura ≥ 70 % y sombra permanente a ≤ 10 km. La propuesta 1 cae a ~15 km de la cresta de Shackleton y las propuestas 2 y 3 junto a Malapert y Nobile Rim 1: el método encuentra las zonas de Artemis III sin que se las indiquemos.

**Búsqueda.** Usa los mismos `span`, grupos y pesos de `parameter_model.json` y solo los parámetros medidos en ambos lados. El resultado guarda los 25 mejores candidatos por objetivo, separados al menos 150 km, y el puesto que obtienen los análogos conocidos del CSV, para comprobar el método.

**Credenciales de Earthdata.** Crea `~/.netrc` (permisos 600) con:

```
machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CONTRASEÑA
```

## Qué mide hoy

| Métrica | Tierra | Marte | Luna (cara visible) | Luna (polo sur) |
|---|---|---|---|---|
| Desnivel, pendiente segura | COP-DEM | MOLA 463 m | LOLA 118 m | LOLA 120 m |
| Luz solar | — | — | 50 % (geometría) | Mapas LOLA (PGDA) |
| Tierra visible | — | — | 100 % (geometría) | Mapas LOLA (PGDA) |
| Hielo | Días de nieve (MODIS) | — | — | Sombra permanente (LOLA) |
| Densidad del aire | — | Mars Climate Database | — | — |

Pendiente (las columnas siguen con datos demo):

- **Luz solar en la Tierra y Marte.** Con horizonte plano da ~50 % en cualquier latitud, así que no distingue sitios. Hay que calcular el horizonte con el DEM o pasar a insolación.
- **Cráteres y rocas.** Catálogos de Robbins y abundancia de rocas de Diviner y TES.
- **Estabilidad del suelo.** Inercia térmica.
- **Más indicadores de hielo:** Diviner, LEND, Mars Odyssey, SWIM y permafrost. Hoy la confianza del hielo lunar es 33 %, porque solo se mide 1 de 3 indicadores.

## Estructura

```text
pipeline/
├── config.json      # ventanas, umbrales y URLs de cada fuente (sin datos en el código)
├── __main__.py      # comandos fetch y apply
├── sites.py         # sitios leídos del CSV de la app
├── raster.py        # lectura de ventanas remotas, reproyección local y caché
├── metrics.py       # cálculos puros (desnivel, pendiente, luz, hielo)
├── collect.py       # qué fuente usa cada sitio
├── output.py        # site_values.json y volcado al CSV
├── sources/         # un módulo por proveedor (DEM, mapas lunares, MCD, AppEEARS)
└── tests/
```
