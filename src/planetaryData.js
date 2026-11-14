// Cada fila del CSV representa una pareja completa Tierra–análogo.

import { PARAMS, paramSimilarity, overallSimilarity } from './similarity.js';

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) records.push(row);
  }

  const [headers, ...values] = records;
  if (!headers?.length) throw new Error('El CSV de ubicaciones está vacío.');
  return values.map((valuesRow) => Object.fromEntries(
    headers.map((header, index) => [header.trim(), (valuesRow[index] ?? '').trim()])
  ));
}

const textFrom = (row, key, recordId) => {
  const value = row[key]?.trim();
  if (!value) throw new Error(`Falta el dato ${key} (${recordId}).`);
  return value;
};

const numberFrom = (row, key, recordId) => {
  if (row[key] === undefined || row[key] === '') {
    throw new Error(`Falta el dato ${key} (${recordId}).`);
  }
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido en ${key} (${recordId}).`);
  return value;
};

function coordinateFrom(row, key, min, max, recordId) {
  const value = numberFrom(row, key, recordId);
  if (value < min || value > max) {
    throw new Error(`Coordenada fuera de rango en ${key} (${recordId}).`);
  }
  return value;
}

function booleanFrom(row, key, recordId) {
  if (row[key] === 'true') return true;
  if (row[key] === 'false') return false;
  throw new Error(`El dato ${key} debe ser true o false (${recordId}).`);
}

function sameAnalogSite(first, second) {
  return ['body', 'name', 'lat', 'lon', 'footprintKm', 'kind', 'why', 'polar']
    .every((key) => first[key] === second[key]);
}

export async function loadPlanetaryData() {
  const response = await fetch('/data/planetary_candidates.csv');
  if (!response.ok) {
    throw new Error(`No se pudo cargar el CSV de ubicaciones (${response.status}).`);
  }

  const rows = parseCsv(await response.text());
  const pairs = [];
  const pairIds = new Set();
  const sitesById = new Map();
  const earthSiteIds = new Set();

  for (const row of rows) {
    const pairId = textFrom(row, 'pair_id', 'registro');
    const earthId = textFrom(row, 'earth_site_id', pairId);
    const candidateId = textFrom(row, 'candidate_id', pairId);
    const body = textFrom(row, 'body', pairId);

    if (pairIds.has(pairId)) throw new Error(`El CSV repite el pair_id ${pairId}.`);
    pairIds.add(pairId);
    if (!['mars', 'moon'].includes(body)) {
      throw new Error(`Cuerpo inválido en el registro ${pairId}: ${body}.`);
    }

    const earthPoint = {
      id: earthId,
      name: textFrom(row, 'earth_site_name', pairId),
      region: textFrom(row, 'earth_region', pairId),
      lat: coordinateFrom(row, 'earth_latitude', -90, 90, pairId),
      lon: coordinateFrom(row, 'earth_longitude', -180, 180, pairId),
      kind: textFrom(row, 'earth_kind', pairId),
      why: textFrom(row, 'earth_description', pairId),
      limits: textFrom(row, 'earth_limits', pairId),
    };
    if (earthSiteIds.has(earthId)) {
      throw new Error(`El CSV repite el earth_site_id ${earthId}; usa un ID por punto seleccionable de la Tierra.`);
    }
    earthSiteIds.add(earthId);

    const site = {
      id: candidateId,
      body,
      name: textFrom(row, 'analog_site_name', pairId),
      lat: coordinateFrom(row, 'analog_latitude', -90, 90, pairId),
      lon: coordinateFrom(row, 'analog_longitude', -180, 180, pairId),
      footprintKm: numberFrom(row, 'footprint_km', pairId),
      kind: textFrom(row, 'analog_kind', pairId),
      why: textFrom(row, 'analog_description', pairId),
      polar: booleanFrom(row, 'analog_polar', pairId),
    };
    const previousSite = sitesById.get(candidateId);
    if (previousSite && !sameAnalogSite(previousSite, site)) {
      throw new Error(`Los datos del candidato ${candidateId} no coinciden entre sus parejas.`);
    }
    if (!previousSite) sitesById.set(candidateId, site);

    pairs.push({
      id: pairId,
      earthPoint,
      analog: { body, lat: site.lat, lon: site.lon, name: site.name, site },
      comparison: row,
    });
  }

  return { pairs };
}

export function similarityDataFromCsv(row, analogBody) {
  if (!row) throw new Error('Falta la fila de comparación en planetary_candidates.csv.');

  const toColumn = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const results = PARAMS
    .filter((param) => !param.bodies || param.bodies.includes(analogBody))
    .map((param) => {
      const column = toColumn(param.key);
      const earth = numberFrom(row, `${column}_earth`, row.earth_site_id);
      const analog = numberFrom(row, `${column}_analog`, row.candidate_id);
      const confidence = param.confidence
        ? {
            earth: numberFrom(row, 'ice_confidence_earth', row.earth_site_id),
            analog: numberFrom(row, 'ice_confidence_analog', row.candidate_id),
          }
        : null;
      return { param, earth, analog, confidence, similarity: paramSimilarity(earth, analog, param.span) };
    });

  return { results, overall: overallSimilarity(results) };
}
