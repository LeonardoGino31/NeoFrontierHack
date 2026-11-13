// Carga desde CSV las ubicaciones extraterrestres y los datos fijos de comparación.

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

const numberFrom = (row, key, description) => {
  if (row[key] === undefined || row[key] === '') {
    throw new Error(`Falta el dato ${key} (${description}).`);
  }
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido en ${key} (${description}).`);
  return value;
};

export async function loadPlanetaryData() {
  const response = await fetch('/data/planetary_candidates.csv');
  if (!response.ok) {
    throw new Error(`No se pudo cargar el CSV de ubicaciones (${response.status}).`);
  }

  const rows = parseCsv(await response.text());
  const sitesById = new Map();
  const comparisonsByEarthSite = {};

  for (const row of rows) {
    const site = {
      id: row.candidate_id,
      body: row.body,
      name: row.site_name,
      lat: numberFrom(row, 'latitude', row.candidate_id),
      lon: numberFrom(row, 'longitude', row.candidate_id),
      footprintKm: numberFrom(row, 'footprint_km', row.candidate_id),
      kind: row.kind,
      why: row.description,
      polar: row.polar === 'true',
    };

    if (!site.id || !['mars', 'moon'].includes(site.body)) {
      throw new Error(`Registro de sitio inválido en el CSV: ${row.candidate_id || '(sin id)'}.`);
    }
    if (!sitesById.has(site.id)) sitesById.set(site.id, site);
    if (comparisonsByEarthSite[row.earth_site_id]) {
      throw new Error(`El CSV repite el sitio terrestre ${row.earth_site_id}.`);
    }
    comparisonsByEarthSite[row.earth_site_id] = row;
  }

  return { sites: [...sitesById.values()], comparisonsByEarthSite };
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
