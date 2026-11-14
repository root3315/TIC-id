import { useState } from "react";
import { motion } from "framer-motion";
import { Weight, Gauge, Thermometer, Circle, Rocket, Sun, Layers, Wind, PersonStanding } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmt, fmtErr, planetClass, densityOf } from "@/lib/format";
import { useT } from "@/lib/i18n";

// Иконка здесь — опознавательный знак параметра, а не украшение:
// цвет ей не нужен, у всех карточек он одинаковый.
const ParamCard = ({ icon: Icon, label, value, unit, hint }) => (
  <div className="panel rounded-xl p-5 hover-lift">
    <div className="flex items-center gap-2 mb-2.5">
      <Icon className="w-3.5 h-3.5" style={{ color: "var(--ink-4)" }} />
      <h3 className="label-mono">{label}</h3>
    </div>
    <p className="text-[26px] font-semibold text-white tabular leading-none">{value ?? "—"}</p>
    {unit && <p className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>{unit}</p>}
    {hint && <p className="text-xs mt-1.5" style={{ color: "var(--ink-4)" }}>{hint}</p>}
  </div>
);

/** Полоса сравнения с Землёй (Земля = 1, отмечена риской) */
const EarthBar = ({ label, value, max, unit = "× Земли", unitEn = "× Earth", color = "#22d3ee" }) => {
  const t = useT();
  if (value == null) return null;
  const pct = Math.min(100, (value / max) * 100);
  const earthPct = Math.min(100, (1 / max) * 100);
  return (
    <div className="py-2">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-slate-300">{label}</span>
        <span className="text-white font-medium tabular">{fmt(value, 2)} {t(unit, unitEn)}</span>
      </div>
      <div className="relative h-2" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: color, borderRadius: 2 }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        <div
          className="absolute -top-1 bottom-[-4px] w-0.5 bg-emerald-300/90"
          style={{ left: `${earthPct}%` }}
          title={t("Земля", "Earth")}
        />
      </div>
    </div>
  );
};

/** Интерактивная карточка «каково там человеку»: вес, прыжок, время перелёта */
const HumanCard = ({ data, derived }) => {
  const t = useT();
  const [kg, setKg] = useState("70");
  const g = derived.surface_gravity_g;
  const distPc = data.host_star?.distance;
  const distLy = derived.distance_ly ?? (distPc != null ? distPc * 3.26156 : null);
  const w = parseFloat(String(kg).replace(",", "."));
  const weightOk = Number.isFinite(w) && w > 0 && w < 1000;

  // высота прыжка: на Земле центр масс поднимается ~на 45 см
  const jumpCm = g ? 45 / g : null;
  // время перелёта
  const flight = distLy != null ? [
    [t("со скоростью света", "at the speed of light"), distLy, t("лет", "yr")],
    [t("на «Вояджере» (17 км/с)", "on Voyager (17 km/s)"), distLy * (299792.458 / 17), t("лет", "yr")],
    [t("на самолёте (900 км/ч)", "by plane (900 km/h)"), distLy * (299792.458 / 0.25), t("лет", "yr")],
  ] : null;

  const fmtBig = (v) => {
    if (v >= 1e9) return `${fmt(v / 1e9, 1)} ${t("млрд", "bn")}`;
    if (v >= 1e6) return `${fmt(v / 1e6, 1)} ${t("млн", "M")}`;
    if (v >= 1e3) return `${fmt(v / 1e3, 1)} ${t("тыс.", "k")}`;
    return fmt(v, 0);
  };

  if (g == null && distLy == null) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
      className="panel rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <PersonStanding className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
        {t("Каково там человеку", "What it's like for a human")}
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        {derived.mass_unreliable
          ? t("масса планеты — верхний предел, поэтому цифры ниже — худший случай", "the planet's mass is an upper limit, so the figures below are a worst case")
          : t("грубые, но честные прикидки по реальным данным", "rough but honest estimates from real data")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {g != null && (
          <div className="rounded-xl bg-slate-900/40 border border-white/5 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">{t("Ваш вес там", "Your weight there")}</p>
            <div className="flex items-center gap-2 mb-2">
              <Input
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                inputMode="decimal"
                className="w-20 h-8 bg-slate-900/60 border-slate-600/40 text-white text-sm rounded-lg tabular"
                data-testid="human-weight"
              />
              <span className="text-xs text-slate-400">{t("кг на Земле", "kg on Earth")}</span>
            </div>
            <p className="text-2xl font-bold text-white tabular">
              {weightOk ? `${fmt(w * g, 0)} ${t("кг", "kg")}` : "—"}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {g > 1.5 ? t("тяжело — как ходить с рюкзаком собственного веса", "heavy — like walking with a backpack of your own weight")
                : g > 1.15 ? t("заметно тяжелее, чем дома", "noticeably heavier than at home")
                : g > 0.85 ? t("почти как на Земле", "almost like on Earth")
                : g > 0.4 ? t("легче — шаги становятся прыжками", "lighter — steps turn into leaps")
                : t("почти невесомость у поверхности", "near weightlessness at the surface")}
            </p>
          </div>
        )}
        {jumpCm != null && (
          <div className="rounded-xl bg-slate-900/40 border border-white/5 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">{t("Прыжок с места", "Standing jump")}</p>
            <p className="text-2xl font-bold text-white tabular mt-7">{fmt(jumpCm, 0)} {t("см", "cm")}</p>
            <p className="text-xs text-slate-500 mt-1">{t("на Земле — около 45 см", "on Earth — about 45 cm")}</p>
          </div>
        )}
        {flight && (
          <div className="rounded-xl bg-slate-900/40 border border-white/5 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">{t("Долететь туда", "Travel time")}</p>
            <ul className="space-y-1.5 mt-1">
              {flight.map(([label, years, unit]) => (
                <li key={label} className="flex justify-between gap-2 text-sm">
                  <span className="text-slate-400">{label}</span>
                  <span className="text-white tabular whitespace-nowrap">{fmtBig(years)} {unit}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const PhysicalTab = ({ data }) => {
  const t = useT();
  const phys = data.physical_params || {};
  const derived = data.derived || {};
  const teq = derived.equilibrium_temp || phys.equilibrium_temp;
  const insol = derived.insolation ?? phys.insolation;
  const density = densityOf(phys.mass, phys.radius, derived.density ?? phys.density);
  const cls = planetClass(phys.radius, density);

  const hasAny = Object.values(phys).some((v) => v != null) || Object.keys(derived).length > 0;
  if (!hasAny) {
    return (
      <div className="panel rounded-xl p-12 text-center">
        <p className="text-xl text-slate-400">{t("Физические параметры не найдены", "No physical parameters found")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Основные измерения */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ParamCard icon={Weight} label={t("Масса", "Mass")}
          value={phys.mass != null ? fmtErr(phys.mass, phys.mass_err) : null}
          unit={t("M⊕ (масс Земли)", "M⊕ (Earth masses)")}
          hint={derived.mass_unreliable
            ? t("⚠ верхний предел из архива — реальная масса, вероятно, заметно меньше", "⚠ upper limit from the archive — the real mass is probably noticeably lower")
            : phys.mass_jupiter != null
              ? `${fmt(phys.mass_jupiter, 3)} ${t("массы Юпитера", "Jupiter masses")}${phys.mass_provenance ? ` · ${phys.mass_provenance}` : ""}`
              : null} />
        <ParamCard icon={Circle} label={t("Радиус", "Radius")}
          value={phys.radius != null ? fmtErr(phys.radius, phys.radius_err) : null}
          unit={t("R⊕ (радиусов Земли)", "R⊕ (Earth radii)")}
          hint={phys.radius_jupiter != null ? `${fmt(phys.radius_jupiter, 3)} ${t("радиуса Юпитера", "Jupiter radii")}` : null} />
        <ParamCard icon={Layers} label={t("Плотность", "Density")}
          value={density != null ? fmt(density, 2) : null}
          unit={t("г/см³ (Земля: 5.51)", "g/cm³ (Earth: 5.51)")}
          hint={derived.density_calculated ? t("рассчитана из массы и радиуса", "computed from mass and radius") : null} />
        <ParamCard icon={Thermometer} label={t("Равновесная температура", "Equilibrium temperature")}
          value={teq != null ? `${fmt(teq, 0)} K` : null}
          unit={teq != null ? `${fmt(teq - 273.15, 0)} °C` : null}
          hint={derived.teq_calculated ? t("оценка по светимости звезды (альбедо 0.3)", "estimated from the star's luminosity (albedo 0.3)") : null} />
      </div>

      {/* Производные величины */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
          {t("Расчётные характеристики", "Computed characteristics")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ParamCard icon={Gauge} label={t("Гравитация на поверхности", "Surface gravity")}
            value={derived.surface_gravity_g != null ? `${fmt(derived.surface_gravity_g, 2)} g` : null}
            unit={derived.surface_gravity_ms2 != null ? `${fmt(derived.surface_gravity_ms2, 1)} ${t("м/с²", "m/s²")}` : null}
            hint={derived.surface_gravity_g != null
              ? `${t("человек весом 70 кг весил бы", "a 70 kg person would weigh")} ${fmt(70 * derived.surface_gravity_g, 0)} ${t("кг", "kg")}` : null} />
          <ParamCard icon={Rocket} label={t("Вторая космическая", "Escape velocity")}
            value={derived.escape_velocity_kms != null ? `${fmt(derived.escape_velocity_kms, 1)} ${t("км/с", "km/s")}` : null}
            unit={t("скорость убегания (Земля: 11.2)", "escape velocity (Earth: 11.2)")}
            hint={derived.escape_velocity_rel != null ? `${fmt(derived.escape_velocity_rel, 2)}× ${t("земной", "Earth's")}` : null} />
          <ParamCard icon={Sun} label={t("Инсоляция", "Insolation")}
            value={insol != null ? `${fmt(insol, 2)} S⊕` : null}
            unit={t("потока солнечного света на Земле", "of the sunlight flux on Earth")}
            hint={derived.insolation_calculated ? t("рассчитана по светимости и орбите", "computed from luminosity and orbit") : null} />
          <ParamCard icon={Wind} label={t("Оценка температуры поверхности", "Surface temperature estimate")}
            value={derived.surface_temp_estimate != null ? `${fmt(derived.surface_temp_estimate, 0)} K` : null}
            unit={derived.surface_temp_estimate != null
              ? `${fmt(derived.surface_temp_estimate - 273.15, 0)} ${t("°C с парниковым эффектом как у Земли", "°C with an Earth-like greenhouse effect")}`
              : null} />
        </div>
      </div>

      {/* Каково там человеку */}
      <HumanCard data={data} derived={derived} />

      {/* Сравнение с Землёй */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="panel rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-1">{t("Сравнение с Землёй", "Comparison with Earth")}</h3>
        <p className="text-xs text-slate-500 mb-4">{t("Зелёная риска — уровень Земли", "The green mark is the Earth level")}</p>
        <div className="divide-y divide-white/5">
          <EarthBar label={t("Радиус", "Radius")} value={phys.radius} max={Math.max(3, (phys.radius || 1) * 1.3)} color="#a78bfa" />
          <EarthBar label={t("Масса", "Mass")} value={phys.mass} max={Math.max(5, (phys.mass || 1) * 1.3)} color="#22d3ee" />
          <EarthBar label={t("Гравитация", "Gravity")} value={derived.surface_gravity_g} max={Math.max(2.5, (derived.surface_gravity_g || 1) * 1.3)} color="#34d399" />
          <EarthBar label={t("Инсоляция", "Insolation")} value={insol} max={Math.max(2.5, (insol || 1) * 1.3)} color="#fbbf24" />
          <EarthBar label={t("Плотность", "Density")} value={density != null ? density / 5.513 : null} max={2.2} color="#fb923c" />
        </div>
      </motion.div>

      {/* Интерпретация */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="panel rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-3">{t("Что это значит", "What this means")}</h3>
        <div className="space-y-2.5 text-sm text-slate-300 leading-relaxed">
          {cls && (
            <p>
              {t("По радиусу и плотности это", "By radius and density this is a")} <b style={{ color: cls.color }}>{cls.label.toLowerCase()}</b>
              {(cls.kind === "rocky" || cls.kind === "super") &&
                t(" — планета с твёрдой поверхностью, на которую теоретически можно высадиться.", " — a planet with a solid surface you could theoretically land on.")}
              {cls.kind === "mini-neptune" &&
                t(" — низкая плотность выдаёт протяжённую газовую оболочку: твёрдой поверхности, скорее всего, нет.", " — the low density reveals an extended gas envelope: there is most likely no solid surface.")}
              {cls.kind === "neptune" &&
                t(" — у неё нет твёрдой поверхности, лишь плотная атмосфера над слоями льда и газа.", " — it has no solid surface, only a dense atmosphere over layers of ice and gas.")}
              {cls.kind === "giant" &&
                t(" — гигантский газовый шар, как Юпитер: высаживаться некуда, но её луны могут быть интересны.", " — a giant ball of gas like Jupiter: nowhere to land, but its moons could be interesting.")}
            </p>
          )}
          {density != null && (
            <p>
              {t("Плотность", "Density")} {fmt(density, 2)} {t("г/см³", "g/cm³")}{" "}
              {density > 7 && t("— выше земной: вероятно, планета богата железом.", "— higher than Earth's: the planet is probably iron-rich.")}
              {density >= 4 && density <= 7 && t("— близка к земной: типичный каменно-железный состав.", "— close to Earth's: a typical rock-iron composition.")}
              {density >= 2 && density < 4 && t("— ниже земной: много воды, льда или мощная атмосфера.", "— lower than Earth's: lots of water, ice or a thick atmosphere.")}
              {density < 2 && t("— очень низкая: планета в основном из газа или льда.", "— very low: the planet is mostly gas or ice.")}
            </p>
          )}
          {teq != null && (
            <p>
              {t("Равновесная температура", "Equilibrium temperature")} {fmt(teq, 0)} K ({fmt(teq - 273.15, 0)} °C){" "}
              {teq > 1000 && t("— поверхность раскалена до свечения; металлы могут плавиться.", "— the surface glows white-hot; metals can melt.")}
              {teq > 373 && teq <= 1000 && t("— вода существует только в виде пара.", "— water exists only as vapour.")}
              {teq >= 240 && teq <= 373 && t("— при подходящем давлении возможна жидкая вода!", "— at the right pressure liquid water is possible!")}
              {teq < 240 && t("— без плотной атмосферы вода замёрзнет.", "— without a dense atmosphere water would freeze.")}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default PhysicalTab;
