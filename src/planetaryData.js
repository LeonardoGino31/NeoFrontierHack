// El CSV contiene parejas Tierra–análogo y candidatos autónomos sin pareja terrestre.

import { paramSimilarity, groupResults, overallSimilarity, checkRequirement } from './similarity.js';
import { provenanceOf, countReal } from './siteValues.js';

/** Convierte el texto CSV (con campos entre comillas) en objetos indexados por encabezado. */
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

/** Texto obligatorio de la fila; falla con el ID del registro para encontrarlo en el CSV. */
const textFrom = (row, key, recordId) => {
  const value = row[key]?.trim();
  if (!value) throw new Error(`Falta el dato ${key} (${recordId}).`);
  return value;
};

/** Número obligatorio y finito de la fila. */
const numberFrom = (row, key, recordId) => {
  if (row[key] === undefined || row[key] === '') {
    throw new Error(`Falta el dato ${key} (${recordId}).`);
  }
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido en ${key} (${recordId}).`);
  return value;
};

/** Número opcional del CSV; vacío representa que el candidato no tiene ese dato. */
function optionalNumberFrom(row, key, recordId) {
  if (row[key] === undefined || row[key] === '') return null;
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido en ${key} (${recordId}).`);
  return value;
}

/** Objeto JSON opcional serializado en una celda del CSV. */
function jsonObjectFrom(row, key, recordId) {
  if (!row[key]) return {};
  let value;
  try {
    value = JSON.parse(row[key]);
  } catch {
    throw new Error(`JSON inválido en ${key} (${recordId}).`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`El dato ${key} debe ser un objeto (${recordId}).`);
  }
  return value;
}

/** Coordenada en grados dentro de [min, max]. */
function coordinateFrom(row, key, min, max, recordId) {
  const value = numberFrom(row, key, recordId);
  if (value < min || value > max) {
    throw new Error(`Coordenada fuera de rango en ${key} (${recordId}).`);
  }
  return value;
}

/** Booleano escrito como `true` o `false`. */
function booleanFrom(row, key, recordId) {
  if (row[key] === 'true') return true;
  if (row[key] === 'false') return false;
  throw new Error(`El dato ${key} debe ser true o false (${recordId}).`);
}

/** Un candidato repetido en varias filas debe tener los mismos datos en todas. */
function sameAnalogSite(first, second) {
  return ['body', 'name', 'lat', 'lon', 'footprintKm', 'kind', 'why', 'polar']
    .every((key) => first[key] === second[key]);
}

/** Descarga el CSV indicado por el modelo y crea parejas y candidatos para los marcadores. */
export async function loadPlanetaryData(model) {
  const response = await fetch(model.dataset);
  if (!response.ok) {
    throw new Error(`No se pudo cargar el CSV de ubicaciones (${response.status}).`);
  }

  const rows = parseCsv(await response.text());
  const pairs = [];
  const candidates = [];
  const pairIds = new Set();
  const candidateIds = new Set();
  const sitesById = new Map();
  const earthSiteIds = new Set();

  for (const row of rows) {
    const recordType = row.record_type || 'pair';
    const recordId = recordType === 'candidate_only'
      ? textFrom(row, 'candidate_id', 'candidato')
      : textFrom(row, 'pair_id', 'registro');
    const candidateId = textFrom(row, 'candidate_id', recordId);
    const body = textFrom(row, 'body', recordId);
    if (!['mars', 'moon'].includes(body)) {
      throw new Error(`Cuerpo inválido en el registro ${recordId}: ${body}.`);
    }

    if (recordType === 'candidate_only') {
      if (candidateIds.has(candidateId)) {
        throw new Error(`El CSV repite el candidate_id ${candidateId}.`);
      }
      candidateIds.add(candidateId);
      const site = {
        id: candidateId,
        body,
        name: textFrom(row, 'analog_site_name', candidateId),
        lat: coordinateFrom(row, 'analog_latitude', -90, 90, candidateId),
        lon: coordinateFrom(row, 'analog_longitude', -180, 180, candidateId),
        footprintKm: numberFrom(row, 'footprint_km', candidateId),
        kind: textFrom(row, 'analog_kind', candidateId),
        why: textFrom(row, 'analog_description', candidateId),
        polar: booleanFrom(row, 'analog_polar', candidateId),
      };
      const eligible = row.candidate_eligible === 'true'
        ? true
        : row.candidate_eligible === 'false'
          ? false
          : (() => { throw new Error(`El dato candidate_eligible debe ser true o false (${candidateId}).`); })();
      candidates.push({
        id: candidateId,
        body,
        site,
        status: textFrom(row, 'candidate_status', candidateId),
        eligible,
        filterStatus: row.candidate_filter_status || 'not_evaluated',
        overallScore: numberFrom(row, 'candidate_overall_score', candidateId),
        scoreIsPartial: row.candidate_score_is_partial === 'true',
        scoringCoveragePercent: optionalNumberFrom(row, 'candidate_scoring_coverage_percent', candidateId),
        parameterDataCoveragePercent: optionalNumberFrom(row, 'candidate_parameter_data_coverage_percent', candidateId),
        hardFilterCoveragePercent: optionalNumberFrom(row, 'candidate_hard_filter_coverage_percent', candidateId),
        groupScores: jsonObjectFrom(row, 'candidate_group_scores_json', candidateId),
        parameterScores: jsonObjectFrom(row, 'candidate_parameter_scores_json', candidateId),
        hardFilters: jsonObjectFrom(row, 'candidate_hard_filters_json', candidateId),
        selectionDetail: jsonObjectFrom(row, 'candidate_selection_detail_json', candidateId),
        factorMetadata: jsonObjectFrom(row, 'candidate_factor_metadata_json', candidateId),
        row,
      });
      continue;
    }
    if (recordType !== 'pair') {
      throw new Error(`Tipo de registro inválido en ${recordId}: ${recordType}.`);
    }

    const pairId = recordId;
    const earthId = textFrom(row, 'earth_site_id', pairId);
    if (pairIds.has(pairId)) throw new Error(`El CSV repite el pair_id ${pairId}.`);
    pairIds.add(pairId);

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

  return { pairs, candidates };
}

/** Prepara los factores del candidato sin crear una comparación terrestre ficticia. */
export function candidateAnalysisDataFromCsv(model, candidate) {
  if (!candidate) throw new Error('Falta el candidato del CSV.');
  const { row, body } = candidate;
  const results = model.parameters.map((param) => ({
    param,
    earth: null,
    analog: optionalNumberFrom(row, param.columns.analog, candidate.id),
    confidence: param.confidenceColumns
      ? {
          earth: null,
          analog: optionalNumberFrom(row, param.confidenceColumns.analog, candidate.id),
        }
      : null,
    factorMetadata: candidate.factorMetadata?.[param.key] ?? null,
    score: candidate.parameterScores[param.key] == null
      ? null
      : Number(candidate.parameterScores[param.key]),
  }));
  const groups = model.groups.map((group) => ({
    group,
    items: results.filter((result) => result.param.group === group.key),
    similarity: (() => {
      const storedScore = candidate.groupScores[group.key];
      const fallbackParameter = group.key === 'ice'
        ? 'ice'
        : group.key === 'illumination'
          ? 'sunlight'
          : null;
      const fallbackScore = fallbackParameter
        ? candidate.factorMetadata?.[fallbackParameter]?.score_0_100
          ?? results.find((result) => result.param.key === fallbackParameter)?.analog
        : null;
      const score = storedScore ?? fallbackScore;
      return score != null && Number.isFinite(Number(score))
        ? Math.max(0, Math.min(100, Number(score))) / 100
        : null;
    })(),
  }));
  const profile = model.bodies[body];
  const req = profile.requirement;
  const requirementValue = optionalNumberFrom(row, req.column, candidate.id);
  return {
    results,
    groups,
    overall: candidate.overallScore / 100,
    profile,
    requirement: {
      req,
      value: requirementValue,
      pass: requirementValue !== null && requirementValue >= req.min,
    },
    candidate,
  };
}

/**
 * Calcula la similitud de una pareja a partir de su fila del CSV, según el modelo.
 * Cada valor lleva su procedencia (medido, calculado, estimado o demo) según site_values.json.
 */
export function similarityDataFromCsv(model, row, analogBody, siteValues) {
  if (!row) throw new Error('Falta la fila de comparación en el CSV de ubicaciones.');
  const earthId = row.earth_site_id;
  const analogId = row.candidate_id;
  const origin = (body, id, metric, value) => provenanceOf(siteValues, body, id, metric, value);

  const results = model.parameters.map((param) => {
    const earth = numberFrom(row, param.columns.earth, earthId);
    const analog = numberFrom(row, param.columns.analog, analogId);
    const confidence = param.confidenceColumns
      ? {
          earth: numberFrom(row, param.confidenceColumns.earth, earthId),
          analog: numberFrom(row, param.confidenceColumns.analog, analogId),
        }
      : null;
    const provenance = {
      earth: origin('earth', earthId, param.key, earth),
      analog: origin(analogBody, analogId, param.key, analog),
    };
    if (confidence) {
      provenance.confidence = {
        earth: origin('earth', earthId, `${param.key}Confidence`, confidence.earth),
        analog: origin(analogBody, analogId, `${param.key}Confidence`, confidence.analog),
      };
    }
    return { param, earth, analog, confidence, provenance,
             similarity: paramSimilarity(earth, analog, param.span) };
  });

  const profile = model.bodies[analogBody];
  const groups = groupResults(results, model.groups, profile.weights);
  const { requirement } = profile;
  const requirementValue = numberFrom(row, requirement.column, analogId);
  const requirementProvenance = origin(analogBody, analogId, requirement.key, requirementValue);
  return {
    results,
    groups,
    overall: overallSimilarity(groups),
    profile,
    requirement: { ...checkRequirement(requirement, requirementValue), provenance: requirementProvenance },
    dataSummary: countReal([
      ...results.flatMap((r) => [r.provenance.earth, r.provenance.analog]),
      requirementProvenance,
    ]),
  };
}
