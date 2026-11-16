// Короткое описание системы человеческим языком, собранное только из каталожных
// чисел: если величины нет, о ней просто не говорим. t(ru, en) — функция перевода.

const COLOURS = {
  O: ["голубой", "голубая", "Blue"], B: ["голубой", "голубая", "Blue"],
  A: ["белый", "белая", "White"], F: ["жёлто-белый", "жёлто-белая", "Yellow-white"],
  G: ["жёлтый", "жёлтая", "Yellow"], K: ["оранжевый", "оранжевая", "Orange"],
  M: ["красный", "красная", "Red"],
};

// [русское слово, род (m/f), английское слово]
const KINDS = {
  supergiant: ["сверхгигант", "m", "supergiant"], giant: ["гигант", "m", "giant"],
  subgiant: ["субгигант", "m", "subgiant"], dwarf: ["карлик", "m", "dwarf"], star: ["звезда", "f", "star"],
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const spectralLetter = ({ spectral_type: sp, temperature: teff }) => {
  const m = /^[OBAFGKM]/.exec(String(sp || "").trim());
  if (m) return m[0];
  if (!teff) return null;
  return teff > 30000 ? "O" : teff > 10000 ? "B" : teff > 7500 ? "A" : teff > 6000 ? "F"
    : teff > 5200 ? "G" : teff > 3700 ? "K" : "M";
};

const starKind = ({ spectral_type: sp, radius }, letter) => {
  const lum = String(sp || "").trim().replace(/^[OBAFGKM][0-9.]*\s*/, "");
  if (/^IV/.test(lum)) return "subgiant";
  if (/^V/.test(lum)) return (letter === "M" || letter === "K") && !(radius > 0.75) ? "dwarf" : "star";
  if (/^III/.test(lum)) return "giant";
  if (/^I/.test(lum)) return "supergiant";
  if (radius >= 100) return "supergiant";
  if (radius >= 10) return "giant";
  if (radius >= 2.5) return "subgiant";
  return (letter === "M" || letter === "K") && radius != null && radius <= 0.75 ? "dwarf" : "star";
};

const starParts = (star) => {
  const letter = spectralLetter(star);
  if (!letter) return null;
  const [word, gender, en] = KINDS[starKind(star, letter)];
  const [masc, fem, enColour] = COLOURS[letter];
  return { ru: `${gender === "f" ? fem : masc} ${word}`, en: `${enColour} ${en}`, gender };
};

export const describeStar = (star, t) => {
  const p = starParts(star);
  return p ? capitalize(t(p.ru, p.en.toLowerCase())) : "";
};

// ---------- числа со словами ----------

const ruNum = (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const enNum = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const roundSmart = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

// Форма слова после числа: [один, два-четыре, пять, дробное]
const ruForm = (n, [one, few, many, fraction]) => {
  if (!Number.isInteger(n)) return fraction;
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 > 10 && mod100 < 20) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
};

const LY_PER_PC = 3.26156;
const LY_NOM = ["световой год", "световых года", "световых лет", "светового года"];
const LY_PREP = ["световом году", "световых годах", "световых годах", "светового года"];
const DAYS = ["день", "дня", "дней", "дня"];

export const lightYears = (pc, t, forms = LY_NOM) => {
  const ly = roundSmart(pc * LY_PER_PC);
  return t(`${ruNum(ly)} ${ruForm(ly, forms)}`, `${enNum(ly)} light ${ly === 1 ? "year" : "years"}`);
};

const days = (d, t) => {
  const v = roundSmart(d);
  return t(`${ruNum(v)} ${ruForm(v, DAYS)}`, `${enNum(v)} ${v === 1 ? "day" : "days"}`);
};

// ---------- планеты ----------

const planetKind = (radius) => {
  if (!(radius > 0)) return null;
  if (radius >= 6) return { ru: "газовый гигант", g: "m", en: "a gas giant" };
  if (radius >= 2.7) return { ru: "нептуноподобная планета", g: "f", en: "a Neptune-like planet" };
  if (radius >= 1.8) return { ru: "мини-нептун", g: "m", en: "a mini-Neptune" };
  if (radius >= 1.25) return { ru: "суперземля", g: "f", en: "a super-Earth" };
  return { ru: "планета размером с Землю", g: "f", en: "an Earth-sized planet" };
};

const inZone = (p, hz) => hz && p.a_au >= hz.inner_optimistic && p.a_au <= hz.outer_optimistic;

const onePlanet = (p, hz, t) => {
  const kind = planetKind(p.radius_earth);
  let ru = "известна одна планета";
  let en = "One planet is known around it";
  if (kind) {
    ru += ` — ${kind.ru}`;
    en += `: ${kind.en}`;
    if (p.period_days > 0) {
      ru += `, год на ${kind.g === "f" ? "которой" : "котором"} длится ${days(p.period_days, (r) => r)}`;
      en += ` whose year lasts ${days(p.period_days, (_r, e) => e)}`;
    }
  }
  let out = t(`${ru}.`, `${en}.`);
  if (inZone(p, hz)) out += t(" Она в оптимистичной зоне обитаемости.", " It lies in the optimistic habitable zone.");
  return out;
};

const manyPlanets = (planets, hz, t) => {
  const n = planets.length;
  const verb = ruForm(n, ["известна", "известны", "известно", "известно"]);
  const noun = ruForm(n, ["планета", "планеты", "планет", "планеты"]);
  const periods = planets.map((p) => p.period_days).filter((d) => d > 0);
  let ru = `${verb} ${n} ${noun}`;
  let en = `${n} planets are known around it`;
  if (periods.length >= 2) {
    const lo = Math.min(...periods);
    const hi = Math.max(...periods);
    ru += `: ближайшая обходит звезду за ${days(lo, (r) => r)}, дальняя — за ${days(hi, (r) => r)}`;
    en += `: the innermost circles the star in ${days(lo, (_r, e) => e)}, the outermost in ${days(hi, (_r, e) => e)}`;
  }
  let out = t(`${ru}.`, `${en}.`);
  const k = planets.filter((p) => inZone(p, hz)).length;
  if (k === 1) out += t(" Одна из них — в оптимистичной зоне обитаемости.", " One of them is in the optimistic habitable zone.");
  if (k > 1) out += t(` ${k} из них — в оптимистичной зоне обитаемости.`, ` ${k} of them are in the optimistic habitable zone.`);
  return out;
};

/** «Оранжевый гигант в 67 световых годах от нас. Вокруг него известна одна планета — …» */
export const systemLede = (star, planets, hz, t) => {
  const p = starParts(star);
  const body = planets.length === 1 ? onePlanet(planets[0], hz, t) : manyPlanets(planets, hz, t);
  if (!p) return t(`Вокруг этой звезды ${body}`, body.replace("around it", "around this star"));
  const where = star.distance_pc > 0
    ? t(` в ${lightYears(star.distance_pc, (r) => r, LY_PREP)} от нас`, ` ${lightYears(star.distance_pc, (_r, e) => e)} away`)
    : "";
  const article = /^[aeiou]/i.test(p.en) ? "An" : "A";
  const first = t(`${capitalize(p.ru)}${where}.`, `${article} ${p.en.toLowerCase()}${where}.`);
  const around = t(p.gender === "f" ? "Вокруг неё" : "Вокруг него", "");
  return `${first} ${t(`${around} ${body}`, body)}`;
};
