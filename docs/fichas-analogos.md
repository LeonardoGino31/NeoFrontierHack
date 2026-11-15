# Fichas de análogos destacados

Cuatro lugares de la Tierra que la búsqueda global de NeoFrontier propone como análogos de
sitios de la Luna o Marte. Se eligieron porque **no** son los análogos clásicos (Antártida
costera, Atacama, Islandia, Hawái) y porque los datos explican por qué se parecen.

Cada ficha dice qué se parece, cuánto, dónde falla la analogía y qué se podría probar allí.
Los números salen de `public/data/planetary_candidates.csv` y `public/data/earth_candidates.json`.
La similitud es el índice de la búsqueda (0–100 %) y combina terreno, luz, albedo, suelo,
hielo y litología con los pesos de cada cuerpo. No dice que un sitio sea apto para una misión.

**Límites comunes a todas las fichas.** La Tierra no reproduce la gravedad (1/6 g en la Luna,
0,38 g en Marte), el vacío lunar, la atmósfera de CO₂ de Marte ni la radiación. La geología
se compara con mapas de escala regional (GLiM a 0,5° en la Tierra, 1:5M en la Luna, 1:20M en
Marte): dice si la roca es del mismo tipo, no si tiene la misma mineralogía. Los peligros
menores que la resolución del DEM (rocas sueltas, grietas) no se miden.

---

## 1. Desiertos negros de basalto ↔ llanuras de lava de Elysium (Marte)

| | Tierra | Marte |
|---|---|---|
| Sitio | Harrat ash Shaam, «Desierto Negro» de Jordania (Rwaished, Mafraq) · 32,1° N, 38,1° E | Cerberus Palus, Elysium Planitia · 5,24° N, 151,39° E (candidato `mars-approx-0001` del backend) |
| Alternativa | Al Haruj, Libia · 27,5° N, 16,5° E | Cerberus Tholi · 3,69° N, 167,72° E (`mars-approx-0006`) |

**Por qué se parecen.** El backend eligió en Elysium las llanuras más planas y seguras de Marte
para aterrizar: la unidad geológica es *Late Amazonian volcanic* (lAv), de las coladas de lava
más jóvenes del planeta. La búsqueda, ahora con litología, no las empareja con dunas del Sáhara,
como hacía el método anterior, sino con **campos de basalto** de la Tierra:

| Parámetro | Harrat ash Shaam | Al Haruj | Cerberus Palus | Cerberus Tholi |
|---|---|---|---|---|
| Litología | basalto (GLiM) | basalto (GLiM) | basalto (lAv) | basalto (lAv) |
| Desnivel en 20 km | 37 m | 42 m | 3 m | 5 m |
| Pendiente segura | 100 % | 100 % | 100 % | 100 % |
| Libre de obstáculos (DEM) | 100 % | 100 % | 100 % | 100 % |
| Albedo | 0,265 | 0,261 | 0,278 | 0,269 |
| Hielo | 0 | 0 | 0 | 0 |
| Similitud | **99,7 %** (puesto 1) | **99,7 %** (puesto 2) | | |

La densidad del aire en Cerberus Palus (0,0132 kg/m³, Mars Climate Database) supera el mínimo de
0,010 kg/m³ que pide el modelo para el descenso.

**Dónde falla.** Las llanuras marcianas son unas diez veces más planas (3–5 m de desnivel frente
a 37–42 m). La estabilidad del suelo no se puede comparar: no hay medida para Marte en el pipeline.
La luz solar no se compara en Marte porque el cálculo geométrico da ~50 % en casi todo el planeta.
La lava de Elysium está cubierta de polvo y regolito fino. Los desiertos de basalto terrestres
están cubiertos de bloques sueltos y tienen erosión por agua.

**Qué se podría probar.** Algoritmos de detección de peligros para el aterrizaje sobre lava joven,
travesías de rover sobre coladas y entre bloques de basalto, y radar de penetración para buscar
tubos de lava, que en Harrat ash Shaam están documentados. Al Haruj es uno de los campos
volcánicos más extensos y menos visitados del norte de África: un buen candidato para una campaña
nueva, lejos de los análogos de siempre.

---

## 2. Rift de Afar (Etiopía) ↔ pozo del Mare Tranquillitatis (Luna)

| | Tierra | Luna |
|---|---|---|
| Sitio | Centro de la depresión de Afar, Etiopía · 11,53° N, 41,63° E | Pozo de Tranquilidad, Mare Tranquillitatis · 8,34° N, 33,22° E |

**Por qué se parecen.** Los mares lunares son coladas de basalto. El pozo de Tranquilidad es una
abertura en el techo de un posible tubo de lava, observada por LRO. La celda de la Tierra más
parecida a todo el sitio cae en los basaltos de Afar, una de las regiones volcánicas más activas
del planeta:

| Parámetro | Afar | Tranquilidad |
|---|---|---|
| Litología | basalto (GLiM) | basalto, unidad Im2 *Upper Mare* |
| Desnivel en 5 km | 9,8 m | 55 m |
| Pendiente segura | 99,9 % | 99,7 % |
| Libre de obstáculos | 99,9 % | 99,3 % |
| Albedo | 0,133 | 0,157 |
| Luz solar | 33,5 % | 50 % |
| Similitud | **92,1 %** (puesto 1) | |

**Validación.** Craters of the Moon (Idaho), el análogo clásico de este sitio por sus coladas y
tubos de lava, pasó del top 32 % de la Tierra con el método anterior al **top 1,2 %** con la
litología. Es la mejor prueba de que la geología corrige la búsqueda donde la roca es lo que
define el análogo.

**Dónde falla.** El basalto lunar está pulverizado por impactos (regolito) y alterado por el
viento solar; el de Afar está fresco o cubierto de sedimentos y sales. Afar tiene una
atmósfera densa y calor extremo, sin vacío ni ciclos de 14 días de luz y 14 de noche. La luz
solar difiere porque en Afar cuentan las nubes y la bruma, y en la Luna solo la geometría. La
estabilidad del suelo no tiene dato en esta celda de la Tierra.

**Qué se podría probar.** Detección de tubos de lava desde la superficie (radar, gravimetría,
sísmica pasiva), entrada y mapeo de cavidades con robots, y construcción con basalto local
(sinterizado, bloques) para refugios dentro de tubos.

---

## 3. Montañas Transantárticas ↔ base lunar cerca de Mons Cabeus (polo sur)

| | Tierra | Luna |
|---|---|---|
| Sitio | Montañas Transantárticas, ~130 km al sur de los Valles Secos de McMurdo · 78,63° S, 160,68° E | Cerca de Mons Cabeus · 82,30° S, 22,13° O (candidato `moon-approx-0001`, elegido por el backend) |

**Por qué se parecen.** El backend eligió este punto para una base permanente: recibe luz el
46,8 % del tiempo (mapas de LOLA), ve la Tierra el 71,7 % del tiempo y tiene sombra
permanente, es decir, posible hielo, dentro de su ventana de 5 km. Su mejor análogo terrestre es un
afloramiento de roca entre hielo, en la región de los análogos antárticos de siempre pero fuera
de los Valles Secos:

| Parámetro | Transantárticas | Mons Cabeus |
|---|---|---|
| Desnivel en 5 km | 141 m | 234 m |
| Pendiente segura | 100 % | 100 % |
| Libre de obstáculos | 100 % | 99,9 % |
| Albedo | 0,349 | 0,330 (LOLA, 1064 nm) |
| Luz solar | 31,7 % | 46,8 % |
| Hielo | 100 (permafrost y nieve) | 100 (sombra permanente; confianza 33 %) |
| Litología | metamórfico (GLiM) | brecha de impacto, unidad Ntp |
| Similitud | **81,1 %** (puesto 1) | |

**Dónde falla.** Es la analogía más débil de las cuatro, y eso también es un resultado: ningún
lugar de la Tierra supera el 81 % para el polo sur lunar. La roca no es la misma (afinidad
0,5): la Tierra no tiene superficies de brecha de impacto a escala regional. La luz llega de
forma muy distinta. En el sitio lunar el Sol nunca sube más de ~9° sobre el horizonte
(90° − 82,3° + 1,5° de oblicuidad), mientras que a 78,6° S en la Tierra llega a ~35° en verano y
desaparece meses en invierno. El hielo lunar estaría en cráteres a −200 °C sin atmósfera; el
antártico es permafrost y nieve. El albedo de LOLA es infrarrojo cercano y sobreestima el visible.

**Qué se podría probar.** Operaciones con el Sol rasante y sombras largas, que son el problema
de navegación del polo sur lunar; energía solar en mástiles altos con horizonte quebrado;
perforación y muestreo de suelo helado; y logística de una base aislada con un solo enlace.

---

## 4. Desierto de El Vizcaíno (Baja California Sur) ↔ Arsia Mons (Marte)

| | Tierra | Marte |
|---|---|---|
| Sitio | Desierto de El Vizcaíno, Baja California Sur, México · 27,3° N, 114,1° O | Flanco de Arsia Mons · 8,26° S, 120,1° O |

**Por qué se parecen.** Arsia Mons es un volcán en escudo de Tharsis con tubos de lava y
fosas colapsadas en sus flancos. La celda más parecida de toda la Tierra está en Baja California
Sur, y una celda vecina (27,5° N, 113,7° O) es también el análogo encontrado para el candidato
`mars-approx-0025` de Amazonis Planitia. La península tiene campos volcánicos jóvenes, y GLiM
clasifica esta zona como basalto:

| Parámetro | El Vizcaíno | Arsia Mons |
|---|---|---|
| Litología | basalto (GLiM) | basalto, unidad Ave *Amazonian volcanic edifice* |
| Desnivel en 20 km | 463 m | 468 m |
| Pendiente segura | 99,0 % | 99,1 % |
| Libre de obstáculos | 97,9 % | 98,5 % |
| Albedo | 0,246 | 0,254 |
| Similitud | **99,6 %** (puesto 1) | |

**Validación.** Lava Beds (California), el análogo clásico de Arsia Mons por sus tubos de lava,
pasó del top 41 % al **top 1,4 %** de la Tierra al añadir la litología.

**Dónde falla.** Arsia Mons **no cumple el requisito de aterrizaje**: en la cima la densidad del
aire es 0,0027 kg/m³, menos de un tercio del mínimo de 0,010. Es un análogo científico, no un
sitio de aterrizaje. La escala tampoco coincide: Arsia Mons mide unos 435 km de diámetro y ~18 km
de altura sobre el datum; la ventana de 20 km solo compara el relieve local. La clase litológica
de GLiM a 0,5° no garantiza que la celda exacta sea una colada; hay que confirmarlo con un mapa
geológico local antes de una campaña.

**Qué se podría probar.** Reconocimiento de tubos de lava y fosas de colapso con imágenes
orbitales terrestres de resolución parecida a HiRISE, para entrenar detectores que luego se usen
en Tharsis.

---

## Lo que el índice global no ve

Los análogos clásicos se eligieron por una propiedad concreta, no por parecerse en todo. La
búsqueda mide cada dimensión por separado (`public/data/validation.json → pairs[].byGroup`) y
eso muestra en qué se parece cada uno:

- **Malapert ↔ Chajnantor** queda en el top 5 % por luz (cielo despejado de altura), aunque en
  el índice global esté en el 62 %.
- **Gale ↔ Pampas de La Joya** y **Meridiani ↔ Río Tinto** quedan en el top 5–6 % por albedo.
  Río Tinto es análogo por sus sulfatos de hierro, una mineralogía que ningún mapa global
  distingue a esta escala.
- **Mons Mouton ↔ Mauna Kea** y **Nobile Rim 1 ↔ Domo C** se usan por logística, altitud y frío,
  dimensiones que la búsqueda no compara. Quedan lejos en todas las demás, y es correcto que así sea.

La conclusión práctica es que **no existe un único «mejor análogo»**: cada lugar de la Tierra lo
es para una dimensión. Por eso la herramienta da el ranking por dimensión además del índice global.
