// Carga y valida el modelo de parámetros (public/data/parameter_model.json).
// El modelo define qué se compara, con qué columnas del CSV, cuánto pesa cada grupo
// según el cuerpo y qué requisito debe cumplir cada sitio. El código no guarda esos datos.

const MODEL_URL = '/data/parameter_model.json';
const BODIES = ['mars', 'moon'];

/** Lanza un error con el contexto del modelo si `condition` es falsa. */
function ensure(condition, message) {
  if (!condition) throw new Error(`parameter_model.json: ${message}`);
}

/** Comprueba que las referencias cruzadas del modelo sean coherentes. */
function validate(model) {
  ensure(typeof model.dataset === 'string' && model.dataset, 'falta "dataset" (ruta del CSV).');
  ensure(Array.isArray(model.groups) && model.groups.length, 'falta la lista "groups".');
  const groupKeys = new Set(model.groups.map((g) => g.key));

  for (const p of model.parameters ?? []) {
    ensure(groupKeys.has(p.group), `el parámetro ${p.key} usa un grupo inexistente (${p.group}).`);
    ensure(p.columns?.earth && p.columns?.analog, `al parámetro ${p.key} le faltan columnas.`);
    ensure(p.span > 0, `el parámetro ${p.key} necesita un "span" positivo.`);
  }
  for (const key of groupKeys) {
    // Un grupo sin parámetros daría un promedio 0/0
    ensure(model.parameters.some((p) => p.group === key), `el grupo ${key} no tiene parámetros.`);
  }

  for (const body of BODIES) {
    const profile = model.bodies?.[body];
    ensure(profile, `falta el perfil del cuerpo ${body}.`);
    for (const key of groupKeys) {
      ensure(Number.isFinite(profile.weights?.[key]), `falta el peso de ${key} para ${body}.`);
    }
    const req = profile.requirement;
    ensure(req?.key && req.column && Number.isFinite(req.min), `requisito incompleto para ${body}.`);
  }
}

/** Congela el objeto y todo lo que contiene, para que ningún módulo altere el modelo compartido. */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Descarga, valida y congela el modelo de parámetros.
 * @returns {Promise<object>} modelo con `dataset`, `groups`, `parameters` y `bodies`.
 */
export async function loadParameterModel(url = MODEL_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo cargar el modelo de parámetros (${response.status}).`);
  }
  const model = await response.json();
  validate(model);
  return deepFreeze(model);
}

/** Requisitos de misión de los cuerpos indicados (todos si no se indica ninguno). */
export function requirementsOf(model, body = null) {
  const bodies = body ? [body] : Object.keys(model.bodies);
  return bodies.map((b) => ({ body: b, ...model.bodies[b].requirement }));
}
