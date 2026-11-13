// Contenido explicativo de cada parámetro (lo que muestra la guía).
// Las fuentes son los datasets que se usarán cuando los datos dejen de ser de demo.

export const PARAM_INFO = {
  elevation: {
    what: 'Altura media del terreno en la región. En la Tierra se mide respecto al nivel del mar; en Marte y la Luna no hay mar, así que se usa una superficie de referencia (el areoide en Marte y una esfera de 1737.4 km en la Luna).',
    why: 'Junto con la pendiente define la forma del terreno. En Marte, las zonas bajas tienen más atmósfera encima, lo que ayuda a frenar con paracaídas durante el aterrizaje.',
    example: 'Altiplano andino y Atacama: zonas altas, secas y con mucha radiación ultravioleta.',
    sources: {
      earth: 'Copernicus DEM GLO-30 / SRTM',
      mars: 'MOLA (Mars Global Surveyor)',
      moon: 'LOLA (Lunar Reconnaissance Orbiter)',
    },
  },
  slope: {
    what: 'Inclinación del terreno. Se calcula a partir del modelo digital de elevación (DEM), comparando la altura de cada celda con la de sus vecinas.',
    why: 'Es uno de los criterios más estrictos para elegir sitios de aterrizaje o bases: las pendientes fuertes complican el aterrizaje, la movilidad de rovers y la construcción.',
    example: 'Black Point Lava Flow (Arizona), usado por la NASA en los ensayos de campo Desert RATS.',
    sources: {
      earth: 'Derivada del DEM (Copernicus / SRTM)',
      mars: 'Derivada de MOLA y DTM de HiRISE',
      moon: 'Derivada de LOLA',
    },
  },
  temperature: {
    what: 'Temperatura media de la superficie a lo largo del año.',
    why: 'Condiciona el diseño térmico de equipos y hábitats, y si el agua puede existir como líquido, como hielo o no existir. En la Luna la media engaña: el ecuador pasa de más de 100 °C de día a cerca de −170 °C de noche.',
    example: 'Valles Secos de McMurdo (Antártida): fríos y secos, uno de los análogos de Marte más estudiados.',
    sources: {
      earth: 'ERA5 (ECMWF) / MODIS LST',
      mars: 'Mars Climate Database / TES',
      moon: 'Diviner (Lunar Reconnaissance Orbiter)',
    },
  },
  roughness: {
    what: 'Qué tan irregular es el terreno a pequeña escala: rocas, crestas, grietas. Se resume en un índice de 0 (liso) a 1 (muy accidentado), por ejemplo a partir del Terrain Ruggedness Index del DEM.',
    why: 'Dos zonas pueden tener la misma pendiente media y ser muy distintas para un rover. La rugosidad afecta la movilidad y el riesgo de aterrizaje.',
    example: 'Campos de lava de Islandia, usados para entrenar astronautas y probar rovers.',
    sources: {
      earth: 'Calculada del DEM (Copernicus / SRTM)',
      mars: 'MOLA / DTM de HiRISE',
      moon: 'LOLA / DTM de LROC NAC',
    },
  },
  albedo: {
    what: 'Fracción de la luz solar que refleja la superficie: 0 sería negro total y 1 un blanco perfecto. Como referencia, Marte ronda 0.25 y la Luna 0.12 de media.',
    why: 'Indica el tipo de material (polvo claro, basalto oscuro) y controla cuánto se calienta el suelo con el sol.',
    example: 'Contraste entre desiertos basálticos oscuros y salares claros como el de Uyuni.',
    sources: {
      earth: 'MODIS (producto MCD43)',
      mars: 'TES (Mars Global Surveyor)',
      moon: 'LROC / Clementine',
    },
  },
  iron: {
    what: 'Abundancia de óxidos de hierro en el suelo, en % de peso (expresado como FeO).',
    why: 'Es la huella química de Marte: su suelo tiene alrededor de 18 % de FeO, frente a unos 5–7 % en la corteza continental terrestre, y su oxidación le da el color rojizo. En la Luna distingue los mares basálticos (más hierro) de las tierras altas (menos).',
    example: 'Río Tinto (España): aguas ácidas y ricas en hierro, análogo de la química de Meridiani Planum.',
    sources: {
      earth: 'EMIT (ISS) / ASTER',
      mars: 'GRS (Mars Odyssey) / CRISM',
      moon: 'GRS (Lunar Prospector) / Clementine',
    },
  },
  ice: {
    what: 'Índice ilustrativo del potencial de encontrar hielo en una región. No representa una concentración medida ni confirma un depósito. La confianza expresa por separado cuán sólida es la evidencia disponible.',
    why: 'El hielo puede ser un objetivo científico y, en misiones futuras, un recurso. Para estimarlo hay que combinar indicios geológicos, térmicos y orbitales; una región en sombra no confirma por sí sola que contenga hielo.',
    example: 'Permafrost y glaciares terrestres pueden servir como análogos para estudiar hielo y operaciones en frío, aunque no equivalen a depósitos extraterrestres.',
    sources: {
      earth: 'Inventarios de glaciares y permafrost',
      mars: 'MRO SHARAD / Mars Odyssey',
      moon: 'LRO Diviner, LEND, LAMP y LOLA',
    },
  },
  landingArea: {
    what: 'Índice ilustrativo de la superficie disponible sin rocas grandes, cráteres, dunas u otros obstáculos dentro de una zona de aterrizaje.',
    why: 'El aterrizador necesita espacio seguro para tocar suelo; los obstáculos también pueden dañar el rover o limitar su primer desplazamiento.',
    example: 'Una planicie amplia y con pocos obstáculos ofrece más opciones de aterrizaje que un campo de rocas o una zona de cráteres.',
    sources: {
      earth: 'DEM e imágenes de alta resolución',
      mars: 'MOLA, CTX y HiRISE (NASA)',
      moon: 'LOLA y LROC NAC (NASA)',
    },
  },
  soilStability: {
    what: 'Índice ilustrativo de firmeza y transitabilidad del suelo, incluyendo polvo, arena suelta y capacidad portante.',
    why: 'El terreno suelto puede hacer que el rover pierda tracción o quede atascado; la capacidad portante también importa durante el aterrizaje.',
    example: 'Suelos compactos y firmes facilitan el desplazamiento frente a dunas de arena fina o polvo profundo.',
    sources: {
      earth: 'DEM, imágenes y mediciones geotécnicas locales',
      mars: 'THEMIS, HiRISE y datos de rover (NASA)',
      moon: 'LOLA, LROC y datos de superficie (NASA)',
    },
  },
  edlConditions: {
    what: 'Índice ilustrativo de las condiciones atmosféricas para la entrada, descenso y aterrizaje (EDL), incluyendo presión/densidad, vientos y polvo atmosférico.',
    why: 'La atmósfera marciana frena el vehículo y el viento o el polvo pueden cambiar las condiciones del descenso. El efecto depende de la temporada y del diseño de la misión.',
    example: 'Una llegada con densidad atmosférica y vientos dentro del margen del sistema EDL reduce la incertidumbre del aterrizaje.',
    sources: {
      earth: 'ERA5 (ECMWF)',
      mars: 'Mars Climate Database / MCS (Mars Reconnaissance Orbiter)',
    },
  },
  traverseAccess: {
    what: 'Índice ilustrativo de facilidad para llegar desde la zona de aterrizaje hasta los objetivos científicos, considerando rutas, pendientes, obstáculos y distancia.',
    why: 'El valor científico de una región depende de que el rover pueda recorrerla con seguridad y dentro de su autonomía.',
    example: 'Un afloramiento interesante a corta distancia y conectado por terreno transitable es más accesible para el rover.',
    sources: {
      earth: 'DEM e imágenes de alta resolución',
      mars: 'MOLA, CTX, HiRISE y mapas de planificación de rover',
      moon: 'LOLA, LROC y mapas de planificación de rover',
    },
  },
  solarEnergy: {
    what: 'Índice ilustrativo de energía solar disponible a lo largo del día y de las estaciones, considerando sombras y latitud.',
    why: 'Es relevante para dimensionar operaciones de un rover que use paneles solares. Su importancia depende de la fuente de energía de la misión.',
    example: 'Un lugar con iluminación frecuente y menos sombras puede ofrecer más oportunidades de recarga a un rover solar.',
    sources: {
      earth: 'NASA POWER / modelos de iluminación',
      mars: 'Modelos de iluminación y Mars Climate Database',
      moon: 'LRO/LOLA y modelos de iluminación',
    },
  },
};

export const OVERALL_INFO = {
  what: 'Resume todos los parámetros en un solo número entre 0 % y 100 %. Es un promedio ponderado: cada parámetro aporta su similitud multiplicada por su peso.',
  why: 'Permite ordenar candidatos y comparar regiones rápido. No es una caja negra: cada número se puede rastrear hasta su parámetro y su fórmula.',
  note: 'La pendiente y la rugosidad pesan más porque son las que más condicionan aterrizajes y movilidad. Los pesos se podrán ajustar según el objetivo (aterrizaje, base, estudio geológico).',
};
