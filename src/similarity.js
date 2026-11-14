// Cálculo de similitud entre una región de la Tierra y su análogo.
// Solo contiene la lógica: los parámetros, pesos y umbrales vienen del modelo
// (public/data/parameter_model.json, cargado por parameterModel.js).

/** Similitud de un subparámetro: 1 si son iguales, baja linealmente hasta 0 al llegar a `span`. */
export function paramSimilarity(earthValue, analogValue, span) {
  return Math.max(0, 1 - Math.abs(earthValue - analogValue) / span);
}

/**
 * Agrupa los resultados de los subparámetros: cada grupo es el promedio simple de los suyos
 * y lleva el peso que le da el objetivo del cuerpo.
 */
export function groupResults(results, groups, weights) {
  return groups.map((group) => {
    const items = results.filter((r) => r.param.group === group.key);
    const similarity = items.reduce((sum, r) => sum + r.similarity, 0) / items.length;
    return { group, weight: weights[group.key], items, similarity };
  });
}

/** Índice global: promedio de los grupos ponderado por su peso. */
export function overallSimilarity(groupedResults) {
  const totalWeight = groupedResults.reduce((sum, g) => sum + g.weight, 0);
  return groupedResults.reduce((sum, g) => sum + g.similarity * g.weight, 0) / totalWeight;
}

/** Evalúa un requisito de misión con el valor medido en el sitio. */
export function checkRequirement(requirement, value) {
  return { req: requirement, value, pass: value >= requirement.min };
}
