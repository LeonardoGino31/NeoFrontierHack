// Contenido explicativo de cada parámetro (lo que muestra la guía).
// Las fuentes son los datasets que se usarán cuando los datos dejen de ser de demo.

export const PARAM_INFO = {
  sunlight: {
    what: 'Porcentaje del tiempo (a lo largo de un año) en que el sitio recibe luz solar directa, teniendo en cuenta la latitud, la estación y las sombras que proyecta el relieve.',
    why: 'Es la principal fuente de energía de una base o un rover. En los bordes de cráteres del polo sur lunar hay puntos iluminados más del 80 % del tiempo; en el ecuador lunar, la noche dura unos 14 días terrestres.',
    example: 'Valles Secos de McMurdo: meses de día continuo y meses de noche, parecido al ciclo de los polos lunares.',
    sources: {
      earth: 'NASA POWER (insolación) + sombras del DEM',
      mars: 'Modelos de iluminación con MOLA y la órbita de Marte',
      moon: 'Mapas de iluminación de LRO LOLA (Moon Trek)',
    },
  },
  albedo: {
    what: 'Fracción de la luz solar que refleja la superficie: 0 sería negro total y 1 un blanco perfecto. Como referencia, Marte ronda 0.25 y la Luna 0.12 de media.',
    why: 'Indica el tipo de material (polvo claro, basalto oscuro) y controla cuánto se calienta el suelo y cuánta luz reflejada reciben paneles y cámaras. No mide cuánto sol llega al sitio: eso es el tiempo con luz solar.',
    example: 'Contraste entre desiertos basálticos oscuros y salares claros como el de Uyuni.',
    sources: {
      earth: 'MODIS (producto MCD43)',
      mars: 'TES (Mars Global Surveyor)',
      moon: 'LROC / Clementine',
    },
  },
  relief: {
    what: 'Diferencia entre el punto más alto y el más bajo dentro del recorte comparado (el mismo ancho en km en ambos cuerpos). Se usa el desnivel local y no la altitud, porque el nivel del mar y las referencias de Marte y la Luna no son comparables.',
    why: 'Resume la forma del terreno a escala de misión: llanuras para aterrizar, bordes de cráter elevados para captar luz o laderas difíciles de recorrer.',
    example: 'Black Point Lava Flow (Arizona), usado por la NASA en los ensayos de campo Desert RATS.',
    sources: {
      earth: 'Copernicus DEM GLO-30 / SRTM',
      mars: 'MOLA (Mars Global Surveyor) y DTM de HiRISE',
      moon: 'LOLA (Lunar Reconnaissance Orbiter)',
    },
  },
  safeSlope: {
    what: 'Porcentaje del área con pendiente menor a 15°, el límite típico para aterrizar. La pendiente se calcula con el modelo digital de elevación (DEM), comparando cada celda con sus vecinas.',
    why: 'Es uno de los criterios más estrictos: las pendientes fuertes complican el aterrizaje, el recorrido de un rover y la construcción de una base.',
    example: 'Llanuras volcánicas de Hawái e Islandia, usadas para probar rovers en terreno inclinado.',
    sources: {
      earth: 'Derivada del DEM (Copernicus / SRTM)',
      mars: 'Derivada de MOLA y DTM de HiRISE',
      moon: 'Derivada de LOLA',
    },
  },
  craterFree: {
    what: 'Porcentaje del área sin cráteres, rocas grandes ni dunas que superen el tamaño que tolera el vehículo. Une cráteres y rugosidad en un solo criterio para no contarlos dos veces.',
    why: 'El aterrizador necesita una zona despejada para tocar suelo y el rover rutas sin obstáculos. En la Tierra casi no hay cráteres: aquí lo que cuenta son los obstáculos en general.',
    example: 'Campos de lava de Islandia, usados para entrenar astronautas y probar rovers entre rocas.',
    sources: {
      earth: 'DEM e imágenes de alta resolución (Sentinel-2, Landsat)',
      mars: 'Catálogo de cráteres de Robbins, CTX y HiRISE',
      moon: 'Catálogo de cráteres de Robbins, LOLA y LROC NAC',
    },
  },
  soilStability: {
    what: 'Índice estimado de firmeza del suelo: si es roca, arena suelta o polvo fino. Casi no hay mediciones directas, así que se aproxima con la inercia térmica (lo que tarda el suelo en calentarse y enfriarse).',
    why: 'El terreno suelto hace que el rover pierda tracción o se atasque, y limita el peso que puede soportar una estructura o un aterrizador.',
    example: 'Las dunas de arena fina de Marte atascaron al rover Spirit; los suelos compactos facilitan el recorrido.',
    sources: {
      earth: 'SoilGrids (densidad del suelo) / inercia térmica con ASTER',
      mars: 'Inercia térmica de THEMIS y TES',
      moon: 'Diviner: abundancia de rocas y regolito',
    },
  },
  ice: {
    what: 'Índice ilustrativo del potencial de encontrar hielo en una región. No representa una concentración medida ni confirma un depósito. La confianza expresa por separado cuán sólida es la evidencia disponible.',
    why: 'El hielo es agua, oxígeno y combustible para una base, y un objetivo científico en Marte. Hay que combinar indicios geológicos, térmicos y orbitales; una región en sombra no confirma por sí sola que contenga hielo.',
    example: 'Permafrost y glaciares terrestres sirven para estudiar hielo y operaciones en frío, aunque no equivalen a depósitos extraterrestres.',
    sources: {
      earth: 'Permafrost (ESA CCI) y cobertura de nieve MODIS',
      mars: 'Neutrones de Mars Odyssey, SHARAD y mapa SWIM',
      moon: 'LRO Diviner, LEND, LAMP y LOLA',
    },
  },
  earthView: {
    what: 'Porcentaje del tiempo en que la Tierra está sobre el horizonte del sitio, y por tanto es posible la comunicación directa. Depende de la posición en la Luna y del relieve que tape el horizonte.',
    why: 'Una base necesita enlace con la Tierra. En la cara visible la Tierra siempre está en el cielo; en los polos aparece y desaparece, y por debajo del mínimo hace falta un satélite relé.',
    example: 'No tiene análogo terrestre: por eso es un requisito del sitio lunar y no se compara con la Tierra.',
    sources: {
      moon: 'Mapas de visibilidad de la Tierra de LRO LOLA (Moon Trek)',
    },
  },
  descent: {
    what: 'Densidad de la atmósfera marciana en la superficie del sitio. Disminuye con la altitud: a más altura, menos aire para frenar. El valor demo se estima con la elevación MOLA y una escala de altura de ~11 km.',
    why: 'El paracaídas y el escudo térmico necesitan aire para frenar. Por eso los aterrizajes en Marte se hacen por debajo de ~+1 km; las cumbres volcánicas como Arsia Mons quedan descartadas aunque su análogo sea bueno.',
    example: 'No tiene análogo terrestre: el aire en la Tierra es unas 60 veces más denso. Por eso es un requisito del sitio de Marte y no se compara con la Tierra.',
    sources: {
      mars: 'Mars Climate Database / MCS (Mars Reconnaissance Orbiter) y elevación MOLA',
    },
  },
};

export const OVERALL_INFO = {
  what: 'Resume la comparación en un número entre 0 % y 100 %. Primero se promedian los subparámetros de cada grupo; después, los grupos se combinan con los pesos del objetivo del cuerpo.',
  why: 'Permite ordenar candidatos y comparar regiones rápido. No es una caja negra: cada número se puede rastrear hasta su subparámetro y su fórmula.',
  note: 'Luna (estación base): pesan más la iluminación y el hielo. Marte (aterrizaje y recorridos): pesa más la topografía. Los requisitos del sitio no entran al índice: un sitio que no los cumple se marca como no apto.',
};
