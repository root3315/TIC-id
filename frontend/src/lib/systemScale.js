// Геометрия линейки системы: логарифмическая ось в астрономических единицах.
// Чистые функции без DOM, чтобы их можно было проверить тестами.

export const AU_PER_SOLAR_RADIUS = 0.00465047;

// Опорные точки Солнечной системы под линейкой: «где была бы Земля».
export const SOLAR_REFERENCE = [
  { ru: "Меркурий", en: "Mercury", a: 0.387 },
  { ru: "Земля", en: "Earth", a: 1.0 },
  { ru: "Марс", en: "Mars", a: 1.524 },
  { ru: "Юпитер", en: "Jupiter", a: 5.203 },
  { ru: "Сатурн", en: "Saturn", a: 9.537 },
  { ru: "Нептун", en: "Neptune", a: 30.07 },
];

const finitePositive = (v) => Number.isFinite(v) && v > 0;

/** Диапазон оси: все планеты с перицентрами и апоцентрами, зона обитаемости
 *  и обязательно 1 а.е., чтобы сравнение с Землёй было всегда. Звезда ось не
 *  растягивает: у красного карлика она съела бы половину ширины. */
export function axisDomain({ planets = [], hz = null }) {
  const values = [0.5, 2];
  planets.forEach((p) => {
    if (!finitePositive(p.a_au)) return;
    const e = Number.isFinite(p.eccentricity) ? Math.min(Math.max(p.eccentricity, 0), 0.95) : 0;
    values.push(p.a_au * (1 - e), p.a_au * (1 + e));
  });
  if (hz && finitePositive(hz.inner_optimistic) && finitePositive(hz.outer_optimistic)) {
    values.push(hz.inner_optimistic, hz.outer_optimistic);
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return [10 ** Math.floor(Math.log10(lo * 0.7)), 10 ** Math.ceil(Math.log10(hi * 1.4))];
}

export const logX = ([lo, hi], width) => (au) =>
  ((Math.log10(au) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * width;

/** Десятичные засечки оси: 0.01, 0.1, 1, 10 … */
export function decadeTicks([lo, hi]) {
  const out = [];
  for (let k = Math.round(Math.log10(lo)); k <= Math.round(Math.log10(hi)); k += 1) out.push(10 ** k);
  return out;
}

/** Подписи планет раскладываются по дорожкам, чтобы не налезали друг на друга.
 *  xs отсортированы по возрастанию; возвращает номер дорожки для каждой. */
export function labelLanes(xs, minGap = 34, lanes = 3) {
  const lastX = Array(lanes).fill(-Infinity);
  return xs.map((x) => {
    let lane = lastX.findIndex((lx) => x - lx >= minGap);
    if (lane === -1) lane = lastX.indexOf(Math.min(...lastX));
    lastX[lane] = x;
    return lane;
  });
}

/** Радиус кружка планеты в пикселях: логарифм радиуса в R⊕, без радиуса — средний. */
export const planetDotRadius = (radiusEarth) =>
  finitePositive(radiusEarth) ? Math.min(11, Math.max(3, 3 + 4 * Math.log10(1 + radiusEarth))) : 4.5;

/** Буква планеты из полного имени: «tau Cet e» → «e». */
export const planetLetter = (name, host) => {
  if (!name) return "";
  const rest = host && name.startsWith(host) ? name.slice(host.length).trim() : name.split(" ").pop();
  return rest || name;
};

export const inHabitableZone = (a, hz) =>
  Boolean(hz && Number.isFinite(a) && a >= hz.inner_optimistic && a <= hz.outer_optimistic);
