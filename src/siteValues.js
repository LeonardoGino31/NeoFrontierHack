// Procedencia de cada valor: public/data/site_values.json lo escribe el pipeline de datos
// (pipeline/) con el estado y la fuente de cada métrica medida. Lo que no aparece ahí, o no
// coincide con el CSV, se trata como valor de demostración.

const VALUES_URL = '/data/site_values.json';

export const STATUS_LABELS = {
  measured: 'Medido',
  derived: 'Calculado',
  estimated: 'Estimado (modelo)',
  demo: 'Demo',
};

const DEMO = Object.freeze({ status: 'demo' });

/** Descarga los valores medidos. Sin archivo (pipeline sin ejecutar), todo se trata como demo. */
export async function loadSiteValues(url = VALUES_URL) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { sites: {} };
    return await response.json();
  } catch {
    // El servidor de desarrollo puede responder index.html en lugar de un 404
    return { sites: {} };
  }
}

/**
 * Procedencia del valor que la app leyó del CSV para `metric` en un sitio.
 * Solo cuenta como real si el CSV tiene el mismo valor que midió el pipeline: si no se
 * ejecutó `apply` o alguien lo editó a mano, el número en pantalla sigue siendo demo.
 */
export function provenanceOf(siteValues, body, siteId, metric, csvValue) {
  const record = siteValues.sites?.[`${body}:${siteId}`]?.metrics?.[metric];
  if (!record || Math.abs(Number(record.value) - csvValue) > 1e-6) return DEMO;
  return { status: record.status, source: record.source, note: record.note };
}

/** Cuántos valores de una lista de procedencias vienen de datos reales. */
export function countReal(provenances) {
  return {
    real: provenances.filter((p) => p.status !== 'demo').length,
    total: provenances.length,
  };
}
