// Форматирование чисел и перевод терминов для всего приложения.
// Язык берём из i18n напрямую: функции вызываются в рендере,
// а смена языка перерисовывает дерево (через LangProvider), поэтому подписи обновляются сами.
import { currentLang as curLang } from "@/lib/i18n";

const L = (ru, en) => (curLang() === "en" ? en : ru);

export const fmt = (v, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (n !== 0 && (Math.abs(n) < 0.001 || Math.abs(n) >= 1e7)) {
    return n.toExponential(2).replace("e", "×10^");
  }
  return n.toLocaleString(curLang() === "en" ? "en-US" : "ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
};

// Значащие цифры вместо экспоненты: 0,00055 читается, «5.5×10^-4» — нет.
export const fmtSig = (v, sig = 2) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (n === 0 || Math.abs(n) >= 1) return fmt(n, 2);
  return n.toLocaleString(curLang() === "en" ? "en-US" : "ru-RU", { maximumSignificantDigits: sig });
};

export const fmtErr = (v, err, digits = 2) => {
  if (v === null || v === undefined) return "—";
  const base = fmt(v, digits);
  if (!err || (err[0] == null && err[1] == null)) return base;
  const plus = err[0] != null ? fmt(Math.abs(err[0]), digits) : "?";
  const minus = err[1] != null ? fmt(Math.abs(err[1]), digits) : "?";
  if (plus === minus) return `${base} ± ${plus}`;
  return `${base} +${plus}/−${minus}`;
};

export const kelvinToC = (k) => (k == null ? null : k - 273.15);

export const METHOD_RU = {
  Transit: "Транзит",
  "Radial Velocity": "Лучевые скорости",
  Microlensing: "Микролинзирование",
  Imaging: "Прямое наблюдение",
  "Transit Timing Variations": "Тайминг транзитов",
  "Eclipse Timing Variations": "Тайминг затмений",
  "Orbital Brightness Modulation": "Модуляция блеска",
  "Pulsar Timing": "Тайминг пульсара",
  "Pulsation Timing Variations": "Тайминг пульсаций",
  Astrometry: "Астрометрия",
  "Disk Kinematics": "Кинематика диска",
};

// на английском отдаём оригинальное название метода (оно уже английское в API)
export const methodRu = (m) => (curLang() === "en" ? m || "—" : METHOD_RU[m] || m || "—");

// Плотность в г/см³: берём измеренную, иначе считаем из массы и радиуса
export const densityOf = (mass, radius, density = null) => {
  if (density != null) return density;
  if (mass != null && radius != null && radius > 0) return (5.513 * mass) / radius ** 3;
  return null;
};

/**
 * Класс планеты. В спорном диапазоне 1.8–2.7 R⊕ решает плотность:
 * ρ ≥ 4 г/см³ — каменистая суперземля, ниже — мини-нептун без поверхности.
 */
export const planetClass = (radius, density = null) => {
  if (radius == null) return null;
  if (radius >= 6) return { label: L("Газовый гигант", "Gas giant"), color: "#f59e0b", kind: "giant" };
  if (radius >= 2.7) return { label: L("Нептуноподобная", "Neptune-like"), color: "#60a5fa", kind: "neptune" };
  if (radius >= 1.8) {
    if (density != null && density >= 4)
      return { label: L("Плотная суперземля", "Dense super-Earth"), color: "#4ade80", kind: "super" };
    if (density == null && radius < 2.2)
      return { label: L("Суперземля", "Super-Earth"), color: "#4ade80", kind: "super" };
    return { label: L("Мини-нептун", "Mini-Neptune"), color: "#38bdf8", kind: "mini-neptune" };
  }
  if (radius >= 1.25) return { label: L("Суперземля", "Super-Earth"), color: "#4ade80", kind: "super" };
  return { label: L("Землеподобная", "Earth-like"), color: "#34d399", kind: "rocky" };
};

export const tempZone = (teq) => {
  if (teq == null) return null;
  if (teq < 200) return { label: L("Ледяная", "Frozen"), color: "#93c5fd" };
  if (teq < 240) return { label: L("Холодная", "Cold"), color: "#7dd3fc" };
  if (teq <= 330) return { label: L("Умеренная", "Temperate"), color: "#34d399" };
  if (teq <= 700) return { label: L("Горячая", "Hot"), color: "#fb923c" };
  return { label: L("Раскалённая", "Scorching"), color: "#ef4444" };
};

export const categoryStyle = (cat) => {
  switch ((cat || "").toLowerCase()) {
    case "earth-like":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-400/40";
    case "promising":
      return "bg-lime-500/15 text-lime-300 border-lime-400/40";
    case "moderate":
      return "bg-amber-500/15 text-amber-300 border-amber-400/40";
    case "challenging":
      return "bg-orange-600/15 text-orange-300 border-orange-400/40";
    case "hostile":
      return "bg-red-500/15 text-red-300 border-red-400/40";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-400/40";
  }
};

export const scoreColor = (score) => {
  if (score == null) return "#94a3b8";
  if (score >= 60) return "#22c55e";
  if (score >= 45) return "#eab308";
  if (score >= 28) return "#f97316";
  return "#ef4444";
};

// Цвет звезды по эффективной температуре: опорные точки по чернотельному цвету,
// чуть насыщеннее, чтобы K-гигант читался оранжевым, а не бежевым. Между точками —
// линейная интерполяция, без ступенек на границах классов.
const STAR_COLOR_STOPS = [
  [2400, [255, 112, 52]], [3000, [255, 140, 72]], [3500, [255, 160, 88]],
  [4000, [255, 182, 108]], [4500, [255, 202, 136]], [5000, [255, 218, 166]],
  [5500, [255, 231, 196]], [6000, [255, 241, 224]], [7000, [244, 243, 255]],
  [8500, [222, 230, 255]], [10000, [204, 216, 255]], [20000, [176, 197, 255]],
  [40000, [155, 176, 255]],
];

export const starColor = (teff) => {
  if (!teff) return "#ffda9e";
  const stops = STAR_COLOR_STOPS;
  const t = Math.min(Math.max(teff, stops[0][0]), stops[stops.length - 1][0]);
  const i = Math.max(1, stops.findIndex(([k]) => k >= t));
  const [t0, c0] = stops[i - 1];
  const [t1, c1] = stops[i];
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return `#${c0.map((v, k) => Math.round(v + (c1[k] - v) * f).toString(16).padStart(2, "0")).join("")}`;
};

export const spectralClassOf = (teff) => {
  if (!teff) return null;
  if (teff > 30000) return "O";
  if (teff > 10000) return "B";
  if (teff > 7500) return "A";
  if (teff > 6000) return "F";
  if (teff > 5200) return "G";
  if (teff > 3700) return "K";
  return "M";
};

export const raToHms = (ra) => {
  if (ra == null) return "—";
  const h = ra / 15;
  const hh = Math.floor(h);
  const m = (h - hh) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  const [uh, um, us] = curLang() === "en" ? ["h", "m", "s"] : ["ч", "м", "с"];
  return `${String(hh).padStart(2, "0")}${uh} ${String(mm).padStart(2, "0")}${um} ${ss.toFixed(1)}${us}`;
};

export const decToDms = (dec) => {
  if (dec == null) return "—";
  const sign = dec < 0 ? "−" : "+";
  const d = Math.abs(dec);
  const dd = Math.floor(d);
  const m = (d - dd) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  return `${sign}${dd}° ${String(mm).padStart(2, "0")}′ ${ss.toFixed(0)}″`;
};

export const plural = (n, one, few, many) => {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
};

export const HISTORY_KEY = "exovision_recent";

export const localHistory = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  },
  add(entry) {
    const items = localHistory.get().filter((e) => e.name !== entry.name);
    items.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
  },
};
