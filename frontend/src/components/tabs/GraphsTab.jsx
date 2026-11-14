import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Gauge, MousePointerClick, Scale as ScaleIcon, Thermometer, Sun, AlertCircle, Loader2 } from "lucide-react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, scoreColor } from "@/lib/format";
import { getScatter } from "@/lib/api";
import { useT } from "@/lib/i18n";
import HabitabilityGauge from "@/components/HabitabilityGauge";
import PlanetVisual from "@/components/PlanetVisual";

const SOLAR_PLANETS = [
  { name: "Меркурий", en: "Mercury", m: 0.055, r: 0.383, color: "#8C7853" },
  { name: "Венера", en: "Venus", m: 0.815, r: 0.949, color: "#FFC649" },
  { name: "Земля", en: "Earth", m: 1.0, r: 1.0, color: "#4169E1" },
  { name: "Марс", en: "Mars", m: 0.107, r: 0.532, color: "#CD5C5C" },
  { name: "Юпитер", en: "Jupiter", m: 317.8, r: 11.21, color: "#DAA520" },
  { name: "Сатурн", en: "Saturn", m: 95.2, r: 9.45, color: "#F4A460" },
  { name: "Уран", en: "Uranus", m: 14.5, r: 4.01, color: "#4FD0E0" },
  { name: "Нептун", en: "Neptune", m: 17.1, r: 3.88, color: "#5B7FDE" },
];

// кривые равной плотности: R = (M / (ρ/5.513))^(1/3)
const densityCurve = (rho, mMin, mMax) => {
  const pts = [];
  for (let i = 0; i <= 40; i += 1) {
    const m = mMin * (mMax / mMin) ** (i / 40);
    pts.push({ m, r: (m / (rho / 5.513)) ** (1 / 3) });
  }
  return pts;
};

const logTicks = (lo, hi) =>
  [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000].filter((v) => v >= lo && v <= hi);

const MRTooltip = ({ active, payload }) => {
  const t = useT();
  if (!active || !payload?.length) return null;
  const p = payload.find((x) => x.payload?.name)?.payload;
  if (!p) return null;
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2.5 text-sm">
      <div className="font-semibold text-white mb-1">{p.en ? t(p.name, p.en) : p.name}</div>
      <div className="text-slate-300 tabular">{t("Масса", "Mass")}: {fmt(p.m, 2)} M⊕</div>
      <div className="text-slate-300 tabular">{t("Радиус", "Radius")}: {fmt(p.r, 2)} R⊕</div>
      {p.m > 0 && p.r > 0 && (
        <div className="text-slate-400 tabular text-xs mt-1">ρ ≈ {fmt((5.513 * p.m) / p.r ** 3, 2)} {t("г/см³", "g/cm³")}</div>
      )}
    </div>
  );
};

/** Крупный маркер целевой планеты — не потеряется среди точек */
const TargetShape = ({ cx, cy, name }) => (
  <g>
    <circle cx={cx} cy={cy} r={16} fill="#22d3ee" opacity={0.18}>
      <animate attributeName="r" values="12;19;12" dur="2.2s" repeatCount="indefinite" />
    </circle>
    <circle cx={cx} cy={cy} r={7.5} fill="#22d3ee" stroke="#fff" strokeWidth={2} />
    <text x={cx} y={cy - 16} textAnchor="middle" fill="#67e8f9" fontSize={12} fontWeight={700}>
      {name}
    </text>
  </g>
);

/** Оси для диаграммы «где она среди всех планет» */
const AXES = [
  { k: "pl_orbper", label: "Период, сут", en: "Period, days", log: true },
  { k: "pl_rade", label: "Радиус, R⊕", en: "Radius, R⊕", log: true },
  { k: "pl_bmasse", label: "Масса, M⊕", en: "Mass, M⊕", log: true },
  { k: "pl_eqt", label: "Температура, K", en: "Temperature, K", log: false },
  { k: "pl_insol", label: "Инсоляция, S⊕", en: "Insolation, S⊕", log: true },
  { k: "pl_dens", label: "Плотность, г/см³", en: "Density, g/cm³", log: false },
  { k: "sy_dist", label: "Расстояние, пк", en: "Distance, pc", log: true },
  { k: "disc_year", label: "Год открытия", en: "Discovery year", log: false },
  { k: "st_teff", label: "T звезды, K", en: "Star T, K", log: false },
  { k: "st_lum", label: "Светимость звезды, L☉", en: "Star luminosity, L☉", log: true },
  { k: "hab", label: "Индекс обитаемости", en: "Habitability index", log: false },
  { k: "esi", label: "ESI (подобие Земле)", en: "ESI (Earth similarity)", log: false },
];

const AxisSelect = ({ value, onChange, exclude }) => {
  const t = useT();
  return (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-56 h-9 bg-slate-900/60 border-slate-600/40 text-slate-200 text-sm rounded-lg">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="bg-slate-800 border-slate-600 text-slate-200">
      {AXES.filter((a) => a.k !== exclude).map((a) => (
        <SelectItem key={a.k} value={a.k}>{t(a.label, a.en)}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  );
};

const ScatterTooltip = ({ active, payload, ax, ay }) => {
  const t = useT();
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p?.n) return null;
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2.5 text-sm">
      <div className="font-semibold text-white mb-1">{p.n}</div>
      <div className="text-slate-300 tabular text-xs">{t(ax.label, ax.en)}: {fmt(p.x, 3)}</div>
      <div className="text-slate-300 tabular text-xs">{t(ay.label, ay.en)}: {fmt(p.y, 3)}</div>
    </div>
  );
};

/** Диаграмма рассеяния по любой паре осей: планета среди всего каталога */
const ScatterExplorer = ({ data }) => {
  const t = useT();
  const [xKey, setXKey] = useState("pl_orbper");
  const [yKey, setYKey] = useState("pl_rade");
  const [resp, setResp] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getScatter(xKey, yKey, data.name)
      .then((r) => { if (!cancelled) setResp(r); })
      .catch(() => { if (!cancelled) setResp(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [xKey, yKey, data.name]);

  const ax = AXES.find((a) => a.k === xKey);
  const ay = AXES.find((a) => a.k === yKey);
  const pts = (resp?.points || []).filter(
    (p) => (!ax.log || p.x > 0) && (!ay.log || p.y > 0)
  );
  const target = resp?.target && (!ax.log || resp.target.x > 0) && (!ay.log || resp.target.y > 0)
    ? [resp.target] : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <span className="text-xs text-slate-500">{t("По горизонтали:", "Horizontal:")}</span>
        <AxisSelect value={xKey} onChange={setXKey} exclude={yKey} />
        <span className="text-xs text-slate-500">{t("по вертикали:", "vertical:")}</span>
        <AxisSelect value={yKey} onChange={setYKey} exclude={xKey} />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
        {resp && <span className="text-xs text-slate-500 tabular">{fmt(resp.total, 0)} {t("планет с обоими параметрами", "planets with both parameters")}</span>}
      </div>
      <div style={{ width: "100%", height: 420 }}>
        <ResponsiveContainer>
          <ComposedChart margin={{ top: 22, right: 26, bottom: 14, left: 8 }}>
            <XAxis type="number" dataKey="x" scale={ax.log ? "log" : "auto"} domain={["auto", "auto"]}
              stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDataOverflow
              label={{ value: `${t(ax.label, ax.en)}${ax.log ? t(" (лог)", " (log)") : ""}`, position: "insideBottom", offset: -8, fill: "#94a3b8", fontSize: 12 }} />
            <YAxis type="number" dataKey="y" scale={ay.log ? "log" : "auto"} domain={["auto", "auto"]}
              stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDataOverflow width={70}
              label={{ value: t(ay.label, ay.en), angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip content={<ScatterTooltip ax={ax} ay={ay} />} cursor={{ strokeDasharray: "4 4", stroke: "#475569" }} />
            <Scatter data={pts} fill="#6366f1" fillOpacity={0.42} isAnimationActive={false}
              shape={(props) => <circle cx={props.cx} cy={props.cy} r={2.3} fill="#818cf8" opacity={0.5} />} />
            {target.length > 0 && (
              <Scatter data={target} isAnimationActive={false}
                shape={(props) => <TargetShape {...props} name={data.name} />} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {resp && !target.length && (
        <p className="text-xs text-amber-300/80 mt-2 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {t(`У ${data.name} не измерен один из выбранных параметров — она не попадает на этот график.`, `${data.name} lacks one of the selected parameters — it does not appear on this chart.`)}
        </p>
      )}
    </>
  );
};

const Section = ({ icon: Icon, title, subtitle, children, delay = 0, glow = false }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    className={`${glow ? "card-glow" : "glass"} rounded-2xl p-6`}
  >
    <div className="flex items-center gap-2.5 mb-1">
      <Icon className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
    {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}
    {children}
  </motion.div>
);

const FactorBar = ({ f }) => {
  const pct = f.max ? (f.score / f.max) * 100 : 0;
  const color = pct > 66 ? "#22c55e" : pct > 40 ? "#eab308" : "#ef4444";
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300">{f.label}</span>
        <span className="text-slate-400 tabular">{f.score}/{f.max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700/50">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
};

/** Шкала: где орбита планеты относительно зоны обитаемости */
const HZBar = ({ hz, a }) => {
  const t = useT();
  const lo = Math.min(hz.inner_optimistic, a) * 0.55;
  const hi = Math.max(hz.outer_optimistic, a) * 1.6;
  const pos = (v) => ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100;
  const seg = (from, to) => ({ left: `${pos(from)}%`, width: `${pos(to) - pos(from)}%` });
  return (
    <div>
      <div className="relative h-10 rounded-xl overflow-hidden bg-slate-800/60">
        <div className="absolute inset-y-0" style={{ ...seg(lo, hz.inner_optimistic), background: "linear-gradient(90deg,#b91c1c,#ea580c)" }} />
        <div className="absolute inset-y-0 bg-lime-600/70" style={seg(hz.inner_optimistic, hz.inner_conservative)} />
        <div className="absolute inset-y-0 bg-emerald-500/85" style={seg(hz.inner_conservative, hz.outer_conservative)} />
        <div className="absolute inset-y-0 bg-lime-600/70" style={seg(hz.outer_conservative, hz.outer_optimistic)} />
        <div className="absolute inset-y-0" style={{ ...seg(hz.outer_optimistic, hi), background: "linear-gradient(90deg,#0369a1,#1e3a8a)" }} />
        {/* планета */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pos(a)}%` }}>
          <div className="w-5 h-5 rounded-full bg-cyan-300 border-2 border-white shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
        </div>
      </div>
      <div className="relative h-9 text-[11px] text-slate-400">
        <span className="absolute left-0 top-1.5">{t("🔥 слишком жарко", "🔥 too hot")}</span>
        <span className="absolute -translate-x-1/2 top-1.5 text-emerald-300 font-medium whitespace-nowrap"
          style={{ left: `${(pos(hz.inner_conservative) + pos(hz.outer_conservative)) / 2}%` }}>
          {t("зона обитаемости", "habitable zone")}
        </span>
        <span className="absolute right-0 top-1.5">{t("❄️ слишком холодно", "❄️ too cold")}</span>
        <span className="absolute -translate-x-1/2 top-5 text-cyan-300 font-semibold tabular whitespace-nowrap"
          style={{ left: `${Math.min(92, Math.max(8, pos(a)))}%` }}>
          {t(`▲ планета: ${fmt(a, 3)} а.е.`, `▲ planet: ${fmt(a, 3)} AU`)}
        </span>
      </div>
    </div>
  );
};

/** Градусник: температура планеты на шкале от льда до пекла */
const TempScale = ({ teq }) => {
  const t = useT();
  const hi = Math.max(1000, teq * 1.25);
  const pos = (v) => Math.min(99, Math.max(0, (v / hi) * 100));
  const marks = [
    { v: 273, label: t("0 °C — лёд тает", "0 °C — ice melts") },
    { v: 288, label: t("Земля (+15 °C)", "Earth (+15 °C)") },
    { v: 373, label: t("вода кипит", "water boils") },
  ].filter((m) => m.v < hi);
  return (
    <div>
      <div className="relative h-9 rounded-xl overflow-hidden"
        style={{
          background: `linear-gradient(90deg, #1e3a8a 0%, #0ea5e9 ${pos(200)}%, #34d399 ${pos(288)}%, #eab308 ${pos(420)}%, #ea580c ${pos(700)}%, #b91c1c 100%)`,
        }}>
        {marks.map((m) => (
          <div key={m.v} className="absolute inset-y-0 w-px bg-white/60" style={{ left: `${pos(m.v)}%` }} />
        ))}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pos(teq)}%` }}>
          <div className="w-5 h-5 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
        </div>
      </div>
      <div className="relative h-10 text-[11px] text-slate-400">
        {marks.map((m) => (
          <span key={m.v} className="absolute -translate-x-1/2 top-1.5 whitespace-nowrap" style={{ left: `${pos(m.v)}%` }}>
            {m.label}
          </span>
        ))}
        <span className="absolute -translate-x-1/2 top-5 text-white font-semibold tabular whitespace-nowrap"
          style={{ left: `${Math.min(90, Math.max(10, pos(teq)))}%` }}>
          ▲ {fmt(teq, 0)} K ({fmt(teq - 273.15, 0)} °C)
        </span>
      </div>
    </div>
  );
};

const GraphsTab = ({ data }) => {
  const t = useT();
  const phys = data.physical_params || {};
  const derived = data.derived || {};
  const hab = data.habitability_score || {};
  const orb = data.orbital_params || {};
  const mass = phys.mass;
  const radius = phys.radius;
  const teq = derived.equilibrium_temp ?? phys.equilibrium_temp;
  const hz = derived.habitable_zone;
  const a = orb.semi_major_axis;

  // границы осей всегда включают планету
  const xLo = Math.min(0.02, mass ? mass / 3 : 0.02);
  const xHi = Math.max(1500, mass ? mass * 3 : 1500);
  const yLo = Math.min(0.3, radius ? radius / 1.6 : 0.3);
  const yHi = Math.max(16, radius ? radius * 1.7 : 16);

  const target = mass && radius ? [{ name: data.name, m: mass, r: radius }] : [];

  // сравнение размеров
  const sizeRow = radius
    ? [
        { name: "Земля", en: "Earth", r: 1, teq: 288, mass: 1 },
        { name: data.name, en: data.name, r: radius, teq, mass, density: derived.density ?? phys.density, self: true },
        { name: "Нептун", en: "Neptune", r: 3.88, teq: 72, mass: 17.1 },
        { name: "Юпитер", en: "Jupiter", r: 11.21, teq: 165, mass: 317.8 },
      ].sort((x, y) => x.r - y.r)
    : [];
  const maxR = sizeRow.length ? Math.max(...sizeRow.map((p) => p.r)) : 1;
  const pxPer = 150 / maxR; // самый большой шар ~150px

  return (
    <div className="space-y-6">
      {/* ===== Панель обитаемости ===== */}
      <Section icon={Gauge} title={t("Панель обитаемости", "Habitability panel")} glow
        subtitle={t("Итоговый индекс, шанс выживания колонии, разбивка по 7 факторам и ключевые риски", "Overall index, colony survival chance, breakdown across 7 factors and key risks")}>
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-start">
          <div className="flex flex-col items-center gap-3 mx-auto">
            <HabitabilityGauge score={hab.total_score || 0} label={t(hab.category_ru, hab.category_en ?? hab.category_ru)}
              sublabel={t(`выживаемость колонии ${fmt(hab.survival_chance, 0)}%`, `colony survival ${fmt(hab.survival_chance, 0)}%`)} size={230} />
            <div className="flex gap-2">
              {hab.esi != null && (
                <span className="tag">
                  ESI {hab.esi} <span className="text-slate-500">{t("(Земля = 1)", "(Earth = 1)")}</span>
                </span>
              )}
              <span className="tag tabular"
                style={{ color: scoreColor(hab.total_score) }}>
                {fmt(hab.total_score, 0)} {t("из 100", "of 100")}
              </span>
            </div>
          </div>
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              {Object.values(hab.factors || {}).map((f) => <FactorBar key={f.label} f={f} />)}
            </div>
            {(hab.risks || []).length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/5 space-y-1.5">
                {hab.risks.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-orange-200/90">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-orange-400" /> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ===== Сравнение размеров ===== */}
      {sizeRow.length > 0 && (
        <Section icon={ScaleIcon} title={t("Сравнение размеров", "Size comparison")} delay={0.05}
          subtitle={t("Все шары — в одном масштабе. Так планета выглядит рядом с мирами Солнечной системы.", "All spheres are to the same scale. This is how the planet looks next to Solar System worlds.")}>
          <div className="flex items-end justify-center gap-6 sm:gap-10 flex-wrap py-4">
            {sizeRow.map((p) => (
              <div key={p.name} className="flex flex-col items-center gap-2">
                <div className={p.self ? "drop-shadow-[0_0_18px_rgba(34,211,238,0.45)]" : ""}>
                  <PlanetVisual radius={p.r} teq={p.teq} mass={p.mass} density={p.density}
                    size={Math.max(14, p.r * pxPer)} />
                </div>
                <div className={`text-sm font-medium ${p.self ? "text-cyan-300" : "text-slate-300"}`}>{t(p.name, p.en)}</div>
                <div className="text-xs text-slate-500 tabular">{fmt(p.r, 2)} R⊕</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ===== Масса — радиус ===== */}
      <Section icon={MousePointerClick} title={t("Масса — радиус (интерактивно)", "Mass — radius (interactive)")} delay={0.1}
        subtitle={t("Пунктирные линии — состав при равной плотности: по ним видно, каменная планета, водная или газовая. Наведите курсор на точки.", "Dashed lines are equal-density compositions: they show whether a planet is rocky, watery or gaseous. Hover over the dots.")}>
        <div style={{ width: "100%", height: 440 }}>
          <ResponsiveContainer>
            <ComposedChart margin={{ top: 24, right: 28, bottom: 14, left: 4 }}>
              <XAxis type="number" dataKey="m" scale="log" domain={[xLo, xHi]}
                ticks={logTicks(xLo, xHi)} stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 12 }}
                label={{ value: t("Масса, M⊕ (лог)", "Mass, M⊕ (log)"), position: "insideBottom", offset: -8, fill: "#94a3b8", fontSize: 12 }} />
              <YAxis type="number" dataKey="r" scale="log" domain={[yLo, yHi]}
                ticks={[0.5, 1, 2, 4, 8, 16, 24].filter((v) => v >= yLo && v <= yHi)}
                stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 12 }}
                label={{ value: t("Радиус, R⊕", "Radius, R⊕"), angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 12 }} />
              <Tooltip content={<MRTooltip />} cursor={{ strokeDasharray: "4 4", stroke: "#475569" }} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
              <Line name={t("лёд / вода (1 г/см³)", "ice / water (1 g/cm³)")} data={densityCurve(1, xLo, xHi)} dataKey="r"
                stroke="#38bdf8" strokeDasharray="5 5" dot={false} strokeWidth={1.2} isAnimationActive={false} legendType="plainline" />
              <Line name={t("камень, как Земля (5.5)", "rock, like Earth (5.5)")} data={densityCurve(5.51, xLo, xHi)} dataKey="r"
                stroke="#22c55e" strokeDasharray="5 5" dot={false} strokeWidth={1.2} isAnimationActive={false} legendType="plainline" />
              <Line name={t("железо (13)", "iron (13)")} data={densityCurve(13, xLo, xHi)} dataKey="r"
                stroke="#f97316" strokeDasharray="5 5" dot={false} strokeWidth={1.2} isAnimationActive={false} legendType="plainline" />
              <Scatter name={t("Солнечная система", "Solar System")} data={SOLAR_PLANETS} isAnimationActive={false}>
                {SOLAR_PLANETS.map((p) => <Cell key={p.name} fill={p.color} stroke="#ffffff66" />)}
              </Scatter>
              {target.length > 0 && (
                <Scatter name={data.name} data={target} legendType="circle" fill="#22d3ee"
                  shape={(props) => <TargetShape {...props} name={data.name} />} isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!target.length && (
          <p className="text-xs text-amber-300/80 mt-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t(`Для ${data.name} не измерены одновременно масса и радиус — планету нельзя нанести на график.`, `${data.name} has no simultaneously measured mass and radius — it cannot be plotted on the chart.`)}
          </p>
        )}
      </Section>

      {/* ===== Где она среди всех планет ===== */}
      <Section icon={Gauge} title={t("Где она среди всех планет каталога", "Where it stands in the whole catalogue")} delay={0.12}
        subtitle={t("Каждая точка — подтверждённая планета NASA. Выберите любую пару осей — ваша планета подсвечена.", "Each dot is a confirmed NASA planet. Pick any pair of axes — your planet is highlighted.")}>
        <ScatterExplorer data={data} />
      </Section>

      {/* ===== Зона обитаемости ===== */}
      {hz && a && (
        <Section icon={Sun} title={t("Где планета относительно зоны обитаемости", "Where the planet lies relative to the habitable zone")} delay={0.15}
          subtitle={t("Зелёная полоса — расстояния от звезды, где на поверхности может существовать жидкая вода (Коппарапу 2013)", "The green band shows distances from the star where liquid water can exist on the surface (Kopparapu 2013)")}>
          <HZBar hz={hz} a={a} />
        </Section>
      )}

      {/* ===== Температура ===== */}
      {teq != null && (
        <Section icon={Thermometer} title={t("Температура планеты на шкале", "Planet temperature on a scale")} delay={0.2}
          subtitle={t("Равновесная температура — без учёта парникового эффекта атмосферы", "Equilibrium temperature — without the atmospheric greenhouse effect")}>
          <TempScale teq={teq} />
        </Section>
      )}
    </div>
  );
};

export default GraphsTab;
