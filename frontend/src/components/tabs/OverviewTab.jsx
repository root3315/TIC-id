import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Calendar, Target, MapPin, Thermometer, BarChart2, AlertCircle,
  CheckCircle, Globe, BookOpen, Tag, Orbit, ExternalLink,
} from "lucide-react";
import { fmt, fmtLy, methodRu, plural, scoreColor } from "@/lib/format";
import PlanetVisual from "@/components/PlanetVisual";
import { prefetchPlanet } from "@/lib/api";
import { useT } from "@/lib/i18n";

const FactCard = ({ icon: Icon, label, value, hint }) => (
  <div className="panel rounded-xl p-5 hover-lift">
    <div className="flex items-center gap-2 mb-2.5">
      <Icon className="w-3.5 h-3.5" style={{ color: "var(--ink-4)" }} />
      <p className="label-mono">{label}</p>
    </div>
    <p className="text-[22px] font-semibold text-white tabular leading-none">{value ?? "—"}</p>
    {hint && <p className="text-xs mt-2 leading-snug" style={{ color: "var(--ink-3)" }}>{hint}</p>}
  </div>
);

/** Когда свет, который мы видим сейчас, покинул планету — и что было тогда на Земле */
const lightDeparture = (distLy, t) => {
  if (!distLy || distLy < 1) return null;
  const year = Math.round(new Date().getFullYear() - distLy);
  const era =
    year >= 1950 ? t("космическая эра уже началась", "the space age had already begun")
    : year >= 1800 ? t("эпоха паровых машин", "the age of steam engines")
    : year >= 1500 ? t("эпоха Великих географических открытий", "the Age of Discovery")
    : year >= 500 ? t("Средневековье", "the Middle Ages")
    : year >= 1 ? t("времена Античности", "antiquity")
    : year >= -3000 ? t("эпоха первых цивилизаций", "the era of the first civilizations")
    : year >= -10000 ? t("каменный век", "the Stone Age")
    : t("задолго до цивилизации", "long before civilization");
  const label = year >= 1 ? t(`~${year} г.`, `~${year} CE`) : t(`~${Math.abs(year - 1)} г. до н. э.`, `~${Math.abs(year - 1)} BCE`);
  return `${label} — ${era}`;
};

const FactorBar = ({ f, index }) => {
  const pct = f.max ? (f.score / f.max) * 100 : 0;
  const color = pct > 66 ? "#22c55e" : pct > 40 ? "#eab308" : "#ef4444";
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between mb-1.5 gap-3">
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{f.label}</span>
        <span className="mono text-xs tabular shrink-0" style={{ color: "var(--ink-3)" }}>{f.score} / {f.max}</span>
      </div>
      <div className="h-1.5 overflow-hidden" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
        <motion.div
          className="h-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, delay: 0.15 + index * 0.07, ease: "easeOut" }}
        />
      </div>
      <div className="flex justify-between mt-1 gap-3">
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>{f.status}</span>
        {f.value && <span className="mono text-xs tabular shrink-0" style={{ color: "var(--ink-2)" }}>{f.value}</span>}
      </div>
    </div>
  );
};

const OverviewTab = ({ data }) => {
  const navigate = useNavigate();
  const t = useT();
  const disc = data.discovery_info || {};
  const phys = data.physical_params || {};
  const derived = data.derived || {};
  const star = data.host_star || {};
  const hab = data.habitability_score || {};
  const system = data.system || {};
  const wiki = data.wikipedia;
  const aliases = data.aliases;
  const factors = hab.factors || {};
  const teq = derived.equilibrium_temp || phys.equilibrium_temp;

  return (
    <div className="space-y-6">
      {/* Wikipedia */}
      {wiki?.extract && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-glow rounded-xl p-6"
        >
          <div className="flex items-start gap-5">
            {wiki.thumbnail && (
              <img
                src={wiki.thumbnail}
                alt={wiki.title}
                className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl object-cover shrink-0 border border-white/10"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
                <h3 className="text-lg font-semibold text-white">{t("Из Википедии", "From Wikipedia")}{wiki.lang === "en" ? t(" (англ.)", " (Eng.)") : ""}</h3>
              </div>
              <p className="text-slate-300 leading-relaxed text-sm">{wiki.extract}</p>
              {wiki.url && (
                <a
                  href={wiki.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-sm text-cyan-400 hover:text-cyan-300"
                >
                  {t("Читать статью полностью", "Read the full article")} <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Быстрые факты */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <FactCard icon={Calendar} label={t("Открыта", "Discovered")}
          value={disc.discovery_year}
          hint={`${methodRu(disc.discovery_method)}${disc.discovery_facility ? ` · ${disc.discovery_facility}` : ""}`} />
        <FactCard icon={MapPin} label={t("Расстояние", "Distance")}
          value={derived.distance_ly ? `${fmtLy(derived.distance_ly)} ${t("св. лет", "ly")}` : null}
          hint={lightDeparture(derived.distance_ly, t)
            ? `${t("видимый сейчас свет вылетел в", "the light we see now left in")} ${lightDeparture(derived.distance_ly, t)}`
            : star.distance ? `${fmt(star.distance, 1)} ${t("парсек", "parsec")}` : null} />
        <FactCard icon={Target} label={t("Период обращения", "Orbital period")}
          value={derived.year_length_days ? `${fmt(derived.year_length_days, 1)} ${t("сут", "days")}` : null}
          hint={derived.year_length_years && derived.year_length_years > 0.5
            ? `${fmt(derived.year_length_years, 2)} ${t("земных лет", "Earth years")}` : null} />
        <FactCard icon={Thermometer} label={t("Температура", "Temperature")}
          value={teq ? `${fmt(teq, 0)} K` : null}
          hint={teq ? `${fmt(teq - 273.15, 0)} °C${derived.teq_calculated ? t(" · расчётная", " · calculated") : ""}` : null} />
      </div>

      {/* Обитаемость: факторы + риски/рекомендации */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <BarChart2 className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Факторы обитаемости", "Habitability factors")}
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            {t("Суммарно", "Total")} {fmt(hab.total_score, 1)}/100 · {t("шанс выживания колонии", "colony survival chance")} {fmt(hab.survival_chance, 0)}%
            {hab.esi != null ? ` · ESI ${hab.esi}` : ""}
          </p>
          <div className="divide-y divide-white/5">
            {Object.entries(factors).map(([key, f], i) => (
              <FactorBar key={key} f={f} index={i} />
            ))}
          </div>
        </motion.div>

        <div className="space-y-6">
          {(hab.risks || []).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="panel rounded-xl p-6 border-l-2 border-l-red-400/60"
            >
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                {t("Риски", "Risks")}
              </h3>
              <ul className="space-y-2.5">
                {hab.risks.map((risk, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    {risk}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
          {(hab.recommendations || []).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="panel rounded-xl p-6 border-l-2 border-l-emerald-400/60"
            >
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                {t("Рекомендации", "Recommendations")}
              </h3>
              <ul className="space-y-2.5">
                {hab.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </div>
      </div>

      {/* Планетная система */}
      {(system.planets || []).length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <Orbit className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Система", "System")} {star.name}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {t(
              `${system.star_count} ${plural(system.star_count || 1, "звезда", "звезды", "звёзд")} · ${system.planet_count} ${plural(system.planet_count || 1, "планета", "планеты", "планет")}${system.moon_count ? ` · ${system.moon_count} лун` : ""} — нажмите на планету, чтобы открыть её`,
              `${system.star_count} ${system.star_count === 1 ? "star" : "stars"} · ${system.planet_count} ${system.planet_count === 1 ? "planet" : "planets"}${system.moon_count ? ` · ${system.moon_count} ${system.moon_count === 1 ? "moon" : "moons"}` : ""} — click a planet to open it`
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-white/10">
                  <th className="py-2 pr-4">{t("Планета", "Planet")}</th>
                  <th className="py-2 pr-4">{t("Орбита, а.е.", "Orbit, AU")}</th>
                  <th className="py-2 pr-4">{t("Период, сут", "Period, days")}</th>
                  <th className="py-2 pr-4">{t("Радиус, R⊕", "Radius, R⊕")}</th>
                  <th className="py-2 pr-4">{t("Масса, M⊕", "Mass, M⊕")}</th>
                  <th className="py-2">T, K</th>
                </tr>
              </thead>
              <tbody>
                {system.planets.map((p) => {
                  const current = p.pl_name === data.name;
                  return (
                    <tr
                      key={p.pl_name}
                      onClick={() => !current && navigate(`/results?name=${encodeURIComponent(p.pl_name)}`)}
                      className={`border-b border-white/5 transition-colors ${
                        current
                          ? "bg-cyan-500/10 text-cyan-100"
                          : "hover:bg-white/5 cursor-pointer text-slate-300"
                      }`}
                      data-testid={`system-planet-${p.pl_name}`}
                    >
                      <td className="py-2.5 pr-4 font-medium flex items-center gap-2.5">
                        <PlanetVisual radius={p.pl_rade} teq={p.pl_eqt} mass={p.pl_bmasse} size={22} />
                        {p.pl_name}
                        {current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-200">{t("вы здесь", "you are here")}</span>}
                      </td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.pl_orbsmax, 4)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.pl_orbper, 2)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.pl_rade, 2)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.pl_bmasse, 2)}</td>
                      <td className="py-2.5 tabular">{fmt(p.pl_eqt, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Похожие планеты */}
      {(data.similar_planets || []).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <Orbit className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
            {t("Похожие планеты", "Similar planets")}
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            {t(
              "Ближайшие соседи по радиусу, температуре и инсоляции во всём каталоге — нажмите, чтобы открыть",
              "The closest neighbours by radius, temperature and insolation across the whole catalogue — click to open"
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.similar_planets.map((p, i) => (
              <motion.button
                key={p.pl_name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.24 + i * 0.04 }}
                onClick={() => navigate(`/results?name=${encodeURIComponent(p.pl_name)}`)}
                onMouseEnter={() => prefetchPlanet(p.pl_name)}
                className="glass rounded-xl p-3 text-center hover-lift hover:border-cyan-400/40 transition-colors"
                data-testid={`similar-${p.pl_name}`}
              >
                <div className="flex justify-center mb-2">
                  <PlanetVisual radius={p.pl_rade} teq={p.pl_eqt} mass={p.pl_bmasse} size={44} />
                </div>
                <p className="text-xs font-medium text-white truncate">{p.pl_name}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 tabular">
                  {p.pl_rade ? `${fmt(p.pl_rade, 1)} R⊕` : "—"}
                  {p.pl_eqt ? ` · ${fmt(p.pl_eqt, 0)} K` : ""}
                </p>
                {p.habitability != null && (
                  <span className="tag tabular mt-1.5" style={{ fontSize: 10 }}
                    title={t("Индекс обитаемости", "Habitability index")}>
                    <i className="dot" style={{ background: scoreColor(p.habitability) }} />
                    {fmt(p.habitability, 0)}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Псевдонимы и источники */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {aliases?.star_aliases?.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="panel rounded-xl p-6"
          >
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Tag className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
              {t("Другие обозначения", "Other designations")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {aliases.star_aliases.slice(0, 16).map((a) => (
                <span key={a} className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/70 border border-slate-600/40 text-slate-300 mono">
                  {a}
                </span>
              ))}
            </div>
            {Object.keys(data.identifiers || {}).some((k) => data.identifiers[k]) && (
              <p className="text-xs text-slate-500 mt-3 mono">
                {["tic", "gaia", "hd", "hip"].filter((k) => data.identifiers?.[k])
                  .map((k) => data.identifiers[k]).join(" · ")}
              </p>
            )}
          </motion.div>
        )}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Источники данных", "Data sources")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {(data.sources_used || []).map((source) => (
              <span key={source} className="tag">
                {source}
              </span>
            ))}
          </div>
          {disc.reference_name && (
            <p className="text-xs text-slate-500 mt-3">
              {t("Первая публикация:", "First publication:")}{" "}
              {disc.reference_url ? (
                <a href={disc.reference_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                  {disc.reference_name}
                </a>
              ) : disc.reference_name}
            </p>
          )}
          {disc.last_update && (
            <p className="text-xs text-slate-600 mt-1">{t("Данные NASA обновлены:", "NASA data updated:")} {disc.last_update}</p>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default OverviewTab;
