import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Star, Thermometer, Zap, Ruler, Clock, Rocket, MapPin, Compass,
  Gauge, RotateCw, Send, Loader2,
} from "lucide-react";
import {
  ComposedChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { fmt, fmtErr, starColor, spectralClassOf, raToHms, decToDms } from "@/lib/format";
import { getScatter } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Маркер текущей звезды на HR-диаграмме */
const StarMark = ({ cx, cy, name }) => (
  <g>
    <circle cx={cx} cy={cy} r={14} fill="#fbbf24" opacity={0.2}>
      <animate attributeName="r" values="10;17;10" dur="2.2s" repeatCount="indefinite" />
    </circle>
    <circle cx={cx} cy={cy} r={6.5} fill="#fbbf24" stroke="#fff" strokeWidth={2} />
    <text x={cx} y={cy - 14} textAnchor="middle" fill="#fcd34d" fontSize={12} fontWeight={700}>{name}</text>
  </g>
);

const HRTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p?.n) return null;
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2.5 text-sm">
      <div className="font-semibold text-white mb-0.5">{p.n}</div>
      <div className="text-slate-300 tabular text-xs">T = {fmt(p.x, 0)} K · L = {fmt(p.y, 4)} L☉</div>
    </div>
  );
};

/** Диаграмма Герцшпрунга—Рассела: звёзды всех планет каталога + эта звезда */
const HRDiagram = ({ data, star, derived }) => {
  const t = useT();
  const [resp, setResp] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getScatter("st_teff", "st_lum", data.name)
      .then((r) => { if (!cancelled) setResp(r); })
      .catch(() => { if (!cancelled) setResp(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [data.name]);

  const lum = derived.star_luminosity
    ?? (star.luminosity_log != null ? 10 ** star.luminosity_log
      : star.radius && star.temperature ? star.radius ** 2 * (star.temperature / 5772) ** 4 : null);
  const cur = resp?.target
    || (star.temperature && lum ? { n: star.name || t("звезда", "star"), x: star.temperature, y: lum } : null);
  const pts = (resp?.points || []).filter((p) => p.x >= 2400 && p.x <= 12000 && p.y > 0);

  if (!loading && !pts.length) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }} className="panel rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Star className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
        {t("Диаграмма Герцшпрунга—Рассела", "Hertzsprung–Russell diagram")}
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        {t("Главный график звёздной астрономии: температура против светимости. Серые точки — звёзды всех планет каталога, ☉ — Солнце. Горячие слева, яркие сверху; диагональ — главная последовательность, где звёзды живут большую часть жизни.", "The key chart of stellar astronomy: temperature versus luminosity. Grey dots are the stars of all planets in the catalog, ☉ is the Sun. Hot on the left, bright on top; the diagonal is the main sequence, where stars spend most of their lives.")}
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("строим по каталогу…", "building from catalog…")}
        </div>
      ) : (
        <div style={{ width: "100%", height: 400 }}>
          <ResponsiveContainer>
            <ComposedChart margin={{ top: 22, right: 26, bottom: 14, left: 8 }}>
              <XAxis type="number" dataKey="x" reversed domain={[2400, 12000]}
                ticks={[3000, 4000, 5000, 6000, 8000, 10000, 12000]} allowDataOverflow
                stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }}
                label={{ value: t("Температура звезды, K (горячее ←)", "Star temperature, K (hotter ←)"), position: "insideBottom", offset: -8, fill: "#94a3b8", fontSize: 12 }} />
              <YAxis type="number" dataKey="y" scale="log" domain={["auto", "auto"]} allowDataOverflow
                stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} width={70}
                label={{ value: t("Светимость, L☉ (лог)", "Luminosity, L☉ (log)"), angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 12 }} />
              <Tooltip content={<HRTooltip />} cursor={{ strokeDasharray: "4 4", stroke: "#475569" }} />
              <Scatter data={pts} isAnimationActive={false}
                shape={(props) => (
                  <circle cx={props.cx} cy={props.cy} r={2.4}
                    fill={starColor(props.payload?.x)} opacity={0.55} />
                )} />
              <Scatter data={[{ n: t("Солнце", "Sun"), x: 5772, y: 1 }]} isAnimationActive={false}
                shape={(props) => (
                  <g>
                    <circle cx={props.cx} cy={props.cy} r={5} fill="#fde047" stroke="#00000055" strokeWidth={1} />
                    <text x={props.cx + 9} y={props.cy + 4} fill="#fde047" fontSize={11}>☉ {t("Солнце", "Sun")}</text>
                  </g>
                )} />
              {cur && (
                <Scatter data={[cur]} isAnimationActive={false}
                  shape={(props) => <StarMark {...props} name={cur.n} />} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {!cur && !loading && (
        <p className="text-xs text-amber-300/80 mt-2">
          {t("Для этой звезды не хватает температуры или светимости — на диаграмму она не нанесена.", "This star lacks a temperature or luminosity value — it is not plotted on the diagram.")}
        </p>
      )}
    </motion.div>
  );
};

const Param = ({ icon: Icon, label, value, unit, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.3, delay }}
    className="panel rounded-xl p-5 hover-lift"
  >
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5" style={{ color: "var(--ink-4)" }} />
      <h3 className="label-mono">{label}</h3>
    </div>
    <p className="text-xl font-bold text-white tabular">{value ?? "—"}</p>
    {unit && <p className="text-xs text-slate-400 mt-1">{unit}</p>}
  </motion.div>
);

const SPECTRAL_DESC = {
  O: "сверхгорячая голубая звезда — живёт всего миллионы лет",
  B: "горячая голубовато-белая звезда",
  A: "белая звезда, ярче и горячее Солнца",
  F: "желтовато-белая звезда, немного горячее Солнца",
  G: "жёлтый карлик — тот же класс, что и наше Солнце",
  K: "оранжевый карлик — спокойный долгожитель",
  M: "красный карлик — самая распространённая звезда Галактики",
};

const SPECTRAL_DESC_EN = {
  O: "super-hot blue star — lives only a few million years",
  B: "hot bluish-white star",
  A: "white star, brighter and hotter than the Sun",
  F: "yellowish-white star, slightly hotter than the Sun",
  G: "yellow dwarf — the same class as our Sun",
  K: "orange dwarf — a calm long-liver",
  M: "red dwarf — the most common star in the Galaxy",
};

const HostStarTab = ({ data }) => {
  const t = useT();
  const star = data.host_star || {};
  const simbad = data.simbad_data;
  const derived = data.derived || {};

  if (!star.name && star.temperature == null) {
    return (
      <div className="panel rounded-xl p-12 text-center">
        <p className="text-xl text-slate-400">{t("Данные о звезде-хозяине не найдены", "No host star data found")}</p>
      </div>
    );
  }

  const color = starColor(star.temperature);
  const specClass = (star.spectral_type || "").charAt(0).toUpperCase() || spectralClassOf(star.temperature);
  const coords = star.coordinates || {};
  const mags = star.magnitudes || {};

  return (
    <div className="space-y-6">
      {/* Портрет звезды */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-glow rounded-xl p-6 sm:p-8"
      >
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <div className="relative shrink-0">
            <div
              className="w-36 h-36 rounded-full"
              style={{
                background: `radial-gradient(circle at 38% 34%, #ffffff, ${color} 42%, ${color}dd 70%)`,
                boxShadow: `0 0 44px ${color}88, 0 0 110px ${color}44`,
              }}
            />
            <div
              className="absolute -inset-4 rounded-full pointer-events-none spin-slow"
              style={{ background: `conic-gradient(transparent 0deg, ${color}22 40deg, transparent 90deg, transparent 180deg, ${color}18 230deg, transparent 280deg)` }}
            />
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-3xl font-bold text-white mb-1.5">{star.name || t("Звезда", "Star")}</h2>
            <p className="text-slate-300 mb-3">
              {star.spectral_type ? (
                <>{t("Спектральный класс", "Spectral class")} <b className="text-amber-300">{star.spectral_type}</b></>
              ) : specClass ? (
                <>{t("Класс", "Class")} <b className="text-amber-300">{specClass}</b> {t("(по температуре)", "(from temperature)")}</>
              ) : t("Класс неизвестен", "Class unknown")}
              {specClass && SPECTRAL_DESC[specClass] && (
                <span className="text-slate-400"> — {t(SPECTRAL_DESC[specClass], SPECTRAL_DESC_EN[specClass])}</span>
              )}
            </p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-x-5 gap-y-1.5 text-sm text-slate-400">
              {star.temperature != null && <span>T = <b className="text-white tabular">{fmt(star.temperature, 0)} K</b></span>}
              {derived.star_luminosity != null && <span>L = <b className="text-white tabular">{fmt(derived.star_luminosity, 3)} L☉</b></span>}
              {simbad?.otype_ru && <span>SIMBAD: <b className="text-white">{simbad.otype_ru}</b></span>}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Физические параметры */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Param icon={Star} label={t("Масса", "Mass")} value={star.mass != null ? fmtErr(star.mass, star.mass_err, 3) : null} unit={t("масс Солнца (M☉)", "solar masses (M☉)")} />
        <Param icon={Ruler} label={t("Радиус", "Radius")} delay={0.04} value={star.radius != null ? fmtErr(star.radius, star.radius_err, 3) : null} unit={t("радиусов Солнца (R☉)", "solar radii (R☉)")} />
        <Param icon={Thermometer} label={t("Температура", "Temperature")} delay={0.08} value={star.temperature != null ? fmtErr(star.temperature, star.temperature_err, 0) : null} unit={t("K (Солнце: 5772 K)", "K (Sun: 5772 K)")} />
        <Param icon={Zap} label={t("Светимость", "Luminosity")} delay={0.12}
          value={derived.star_luminosity != null ? fmt(derived.star_luminosity, 4) : null}
          unit={star.luminosity_log != null ? `L☉ (log = ${fmt(star.luminosity_log, 3)})` : "L☉"} />
        <Param icon={Gauge} label={t("Металличность", "Metallicity")} delay={0.16}
          value={star.metallicity != null ? fmt(star.metallicity, 3) : null}
          unit={`${star.metallicity_ratio || "[Fe/H]"} dex ${t("(Солнце: 0)", "(Sun: 0)")}`} />
        <Param icon={Clock} label={t("Возраст", "Age")} delay={0.2}
          value={star.age != null ? fmtErr(star.age, star.age_err, 2) : null}
          unit={t("млрд лет (Солнце: 4.6)", "billion years (Sun: 4.6)")} />
        <Param icon={Gauge} label={t("Поверхностная гравитация", "Surface gravity")} delay={0.24}
          value={star.gravity_log != null ? fmt(star.gravity_log, 2) : null} unit={t("log g (Солнце: 4.44)", "log g (Sun: 4.44)")} />
        <Param icon={RotateCw} label={t("Вращение", "Rotation")} delay={0.28}
          value={star.rotation_period != null ? `${fmt(star.rotation_period, 1)} ${t("сут", "d")}`
            : star.vsini != null ? `${fmt(star.vsini, 1)} ${t("км/с", "km/s")}` : null}
          unit={star.rotation_period != null ? t("период вращения", "rotation period") : "v·sin(i)"} />
        <Param icon={Send} label={t("Лучевая скорость", "Radial velocity")} delay={0.32}
          value={star.radial_velocity != null ? `${fmt(star.radial_velocity, 1)} ${t("км/с", "km/s")}`
            : simbad?.radial_velocity_kms != null ? `${fmt(simbad.radial_velocity_kms, 1)} ${t("км/с", "km/s")}` : null}
          unit={t("движение к нам (−) или от нас (+)", "motion toward us (−) or away (+)")} />
      </div>

      {/* HR-диаграмма */}
      <HRDiagram data={data} star={star} derived={derived} />

      {/* Расстояние и путешествие */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Расстояние от Земли", "Distance from Earth")}
          </h3>
          {star.distance != null ? (
            <>
              <div className="flex items-end gap-3 mb-1">
                <span className="text-4xl font-semibold text-white tabular">{fmt(derived.distance_ly, 1)}</span>
                <span className="text-slate-300 pb-1.5">{t("световых лет", "light-years")}</span>
              </div>
              <p className="text-sm text-slate-400 tabular">
                {fmtErr(star.distance, star.distance_err, 1)} {t("парсек", "parsecs")}
                {star.parallax_mas != null ? ` · ${t("параллакс", "parallax")} ${fmt(star.parallax_mas, 3)} mas` : ""}
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-300">
                  <Rocket className="w-4 h-4 text-orange-400 shrink-0" />
                  {t("Зонд типа «Вояджер» (17 км/с):", "Voyager-type probe (17 km/s):")} <b className="text-white tabular">{fmt(derived.travel_time_voyager_years, 0)} {t("лет", "yr")}</b>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Rocket className="w-4 h-4 shrink-0" style={{ color: "var(--ink-3)" }} />
                  {t("Корабль на 20% скорости света:", "Ship at 20% the speed of light:")} <b className="text-white tabular">{fmt(derived.travel_time_20c_years, 0)} {t("лет", "yr")}</b>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Zap className="w-4 h-4 text-yellow-300 shrink-0" />
                  {t("Свет (радиосигнал):", "Light (radio signal):")} <b className="text-white tabular">{fmt(derived.distance_ly, 1)} {t("лет", "yr")}</b>
                </div>
              </div>
            </>
          ) : (
            <p className="text-slate-400">{t("Расстояние не измерено", "Distance not measured")}</p>
          )}
        </motion.div>

        {/* Координаты */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Compass className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Положение на небе", "Position in the sky")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">{t("Прямое восхождение (RA)", "Right ascension (RA)")}</div>
              <div className="text-white tabular">{coords.ra_str || raToHms(coords.ra)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">{t("Склонение (Dec)", "Declination (Dec)")}</div>
              <div className="text-white tabular">{coords.dec_str || decToDms(coords.dec)}</div>
            </div>
            {coords.gal_lon != null && (
              <div>
                <div className="text-xs text-slate-500 mb-0.5">{t("Галактические координаты", "Galactic coordinates")}</div>
                <div className="text-white tabular">l = {fmt(coords.gal_lon, 2)}°, b = {fmt(coords.gal_lat, 2)}°</div>
              </div>
            )}
            {star.proper_motion != null && (
              <div>
                <div className="text-xs text-slate-500 mb-0.5">{t("Собственное движение", "Proper motion")}</div>
                <div className="text-white tabular">{fmt(star.proper_motion, 1)} {t("mas/год", "mas/yr")}</div>
              </div>
            )}
          </div>
          {Object.keys(mags).length > 0 && (
            <>
              <div className="divider-glow my-4" />
              <div className="text-xs text-slate-500 mb-2">{t("Видимые звёздные величины", "Apparent magnitudes")}</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(mags).map(([band, v]) => (
                  <span key={band} className="px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-600/40 text-xs mono">
                    <span className="text-slate-400">{band}</span>{" "}
                    <span className="text-white tabular">{fmt(v, 2)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>

      {/* SIMBAD идентификаторы */}
      {simbad?.identifiers?.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-3">{t("Идентификаторы SIMBAD", "SIMBAD identifiers")} ({simbad.identifiers.length})</h3>
          <div className="flex flex-wrap gap-2">
            {simbad.identifiers.map((id) => (
              <span key={id} className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/70 border border-slate-600/40 text-slate-300 mono">
                {id}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default HostStarTab;
