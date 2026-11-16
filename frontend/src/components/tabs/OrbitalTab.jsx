import { motion } from "framer-motion";
import { Orbit, Clock, Compass, Route, Play, Waves, Timer, Zap, Sun } from "lucide-react";
import { fmt, fmtErr, starColor } from "@/lib/format";
import OrbitCanvas from "@/components/OrbitCanvas";
import { useT } from "@/lib/i18n";

/** Вид неба с планеты: каким выглядит её солнце по сравнению с нашим */
const SkyFromPlanet = ({ star, orb, derived }) => {
  const t = useT();
  const a = orb.semi_major_axis;              // а.е.
  const rStar = star.radius;                  // R☉
  const insol = derived.insolation;           // S⊕
  if (!a || a <= 0 || (!rStar && insol == null)) return null;

  // видимый диаметр: Солнце с Земли 0.533°; масштабируется как R★/a
  const sizeRatio = rStar ? rStar / a : null;             // 1 = как наше Солнце
  const appDeg = sizeRatio ? 0.533 * sizeRatio : null;
  const color = starColor(star.temperature);
  const basePx = 46;
  const px = sizeRatio ? Math.max(10, Math.min(170, basePx * sizeRatio)) : basePx;

  const sizeText = sizeRatio == null ? null
    : sizeRatio > 1.15 ? t(`в ${fmt(sizeRatio, 1)} раза крупнее нашего Солнца`, `${fmt(sizeRatio, 1)}× larger than our Sun`)
    : sizeRatio < 0.85 ? t(`в ${fmt(1 / sizeRatio, 1)} раза меньше нашего Солнца`, `${fmt(1 / sizeRatio, 1)}× smaller than our Sun`)
    : t("примерно как наше Солнце", "about the same as our Sun");
  const brightText = insol == null ? null
    : insol > 1.2 ? t(`светит в ${fmt(insol, 1)} раза ярче, чем Солнце на Земле`, `shines ${fmt(insol, 1)}× brighter than the Sun on Earth`)
    : insol < 0.8 ? t(`светит в ${fmt(1 / insol, 1)} раза слабее, чем Солнце на Земле`, `shines ${fmt(1 / insol, 1)}× fainter than the Sun on Earth`)
    : t("света почти столько же, сколько на Земле", "about as much light as on Earth");

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22 }} className="panel rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Sun className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
        {t("Небо этой планеты", "The sky of this planet")}
      </h3>
      <p className="text-xs text-slate-500 mb-5">
        {t("Сравнение видимого размера её солнца с нашим — по радиусу звезды и расстоянию орбиты.", "Comparing the apparent size of its sun with ours — from the star's radius and the orbital distance.")}
      </p>
      <div className="flex items-end justify-center gap-14 sm:gap-24 py-4">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full" style={{
            width: basePx, height: basePx,
            background: "radial-gradient(circle at 36% 32%, #fffde7, #fde047 55%, #f59e0b)",
            boxShadow: "0 0 26px #fde04766, 0 0 70px #fde04722",
          }} />
          <div className="text-xs text-slate-400 text-center">{t("Солнце с Земли", "The Sun from Earth")}<br />0.53°</div>
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full" style={{
            width: px, height: px,
            background: `radial-gradient(circle at 36% 32%, #ffffff, ${color} 55%, ${color}cc)`,
            boxShadow: `0 0 30px ${color}77, 0 0 80px ${color}33`,
          }} />
          <div className="text-xs text-slate-300 text-center font-medium">
            {star.name || t("её солнце", "its sun")} {t("с планеты", "from the planet")}
            {appDeg != null && <><br /><span className="text-slate-400 tabular">{fmt(appDeg, 2)}°</span></>}
          </div>
        </div>
      </div>
      <div className="text-sm text-slate-300 text-center space-y-1">
        {sizeText && <p>{t("На небе планеты её звезда выглядит", "In the planet's sky its star looks")} <b className="text-white">{sizeText}</b>.</p>}
        {brightText && <p>{t("И", "And it")} {brightText}.</p>}
        {derived.tidal_locking === "likely" && (
          <p className="text-amber-300/80 text-xs mt-2">
            {t("Из-за приливного захвата это солнце висит в одной точке неба вечно — закатов здесь не бывает.", "Because of tidal locking this sun hangs at a single point in the sky forever — there are no sunsets here.")}
          </p>
        )}
      </div>
    </motion.div>
  );
};

const Param = ({ icon: Icon, label, value, unit, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: -14 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.35, delay }}
    className="panel rounded-xl p-5 hover-lift"
  >
    <div className="flex items-center gap-2.5 mb-2">
      <div className="p-1.5 bg-cyan-500/15 rounded-lg">
        <Icon className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
      </div>
      <h3 className="label-mono">{label}</h3>
    </div>
    <p className="text-xl font-bold text-white tabular">{value ?? "—"}</p>
    {unit && <p className="text-xs text-slate-400 mt-1">{unit}</p>}
  </motion.div>
);

const HZ_LABEL = {
  conservative: { text: "Планета находится в консервативной зоне обитаемости — лучший возможный вариант для жидкой воды.", textEn: "The planet lies in the conservative habitable zone — the best possible case for liquid water.", color: "text-emerald-300" },
  optimistic: { text: "Планета в оптимистичной зоне обитаемости — вода возможна при благоприятной атмосфере.", textEn: "The planet is in the optimistic habitable zone — water is possible with a favourable atmosphere.", color: "text-lime-300" },
  inner: { text: "Орбита ближе внутренней границы зоны обитаемости — планета получает слишком много тепла.", textEn: "The orbit is inside the inner edge of the habitable zone — the planet receives too much heat.", color: "text-orange-300" },
  outer: { text: "Орбита дальше внешней границы зоны обитаемости — планете не хватает тепла звезды.", textEn: "The orbit is beyond the outer edge of the habitable zone — the planet lacks the star's warmth.", color: "text-sky-300" },
};

const OrbitalTab = ({ data }) => {
  const t = useT();
  const orb = data.orbital_params || {};
  const derived = data.derived || {};
  const star = data.host_star || {};
  const hz = derived.habitable_zone;

  const hasAny = Object.values(orb).some((v) => v != null);
  if (!hasAny) {
    return (
      <div className="panel rounded-xl p-12 text-center">
        <p className="text-xl text-slate-400">{t("Орбитальные параметры не найдены", "No orbital parameters found")}</p>
      </div>
    );
  }

  const a = orb.semi_major_axis;
  const hzInfo = HZ_LABEL[derived.hz_position];

  return (
    <div className="space-y-6">
      {/* Живая анимация орбиты */}
      {a && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-glow rounded-xl p-6"
        >
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Play className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
              {t("Орбита в движении", "Orbit in motion")}
            </h2>
            <span className="text-xs text-slate-500">
              {t("скорость движения соответствует закону Кеплера · зелёное кольцо — зона обитаемости", "the motion speed follows Kepler's law · the green ring is the habitable zone")}
            </span>
          </div>
          <OrbitCanvas
            a={a}
            e={orb.eccentricity || 0}
            hz={hz}
            starTeff={star.temperature}
            planetName={data.name}
            height={440}
          />
          {hzInfo && <p className={`text-sm mt-2 ${hzInfo.color}`}>{t(hzInfo.text, hzInfo.textEn)}</p>}
          {hz && (
            <p className="text-xs text-slate-500 mt-1.5 tabular">
              {t("Зона обитаемости (Коппарапу и др., 2013): консервативная", "Habitable zone (Kopparapu et al., 2013): conservative")} {fmt(hz.inner_conservative, 3)}–{fmt(hz.outer_conservative, 3)} {t("а.е.,", "AU,")}
              {" "}{t("оптимистичная", "optimistic")} {fmt(hz.inner_optimistic, 3)}–{fmt(hz.outer_optimistic, 3)} {t("а.е.", "AU")}
              {hz.teff_clamped && ` ${t(
                `Формула верна для звёзд 2600–7200 K, поэтому границы посчитаны для ${fmt(hz.teff_used, 0)} K, а не для ${fmt(star.temperature, 0)} K.`,
                `The formula holds for 2600–7200 K stars, so the bounds are computed for ${fmt(hz.teff_used, 0)} K, not ${fmt(star.temperature, 0)} K.`)}`}
            </p>
          )}
        </motion.div>
      )}

      {/* Главные параметры */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Param icon={Clock} label={t("Орбитальный период", "Orbital period")}
          value={orb.period != null ? fmtErr(orb.period, orb.period_err) : null}
          unit={derived.year_length_years && derived.year_length_years > 0.3
            ? t(`суток (${fmt(derived.year_length_years, 2)} земных лет)`, `days (${fmt(derived.year_length_years, 2)} Earth years)`) : t("земных суток", "Earth days")} />
        <Param icon={Route} label={t("Большая полуось", "Semi-major axis")} delay={0.05}
          value={a != null ? fmtErr(a, orb.semi_major_axis_err, 4) : null}
          unit={a != null ? t(`а.е. (${fmt(a * 149.6, 1)} млн км)`, `AU (${fmt(a * 149.6, 1)} M km)`) : t("а.е.", "AU")} />
        <Param icon={Orbit} label={t("Эксцентриситет", "Eccentricity")} delay={0.1}
          value={orb.eccentricity != null ? fmt(orb.eccentricity, 4) : null}
          unit={t("0 — круг, ближе к 1 — вытянутый эллипс", "0 — a circle, closer to 1 — a stretched ellipse")} />
        <Param icon={Compass} label={t("Наклонение", "Inclination")} delay={0.15}
          value={orb.inclination != null ? `${fmt(orb.inclination, 2)}°` : null}
          unit={t("к лучу зрения с Земли", "to the line of sight from Earth")} />
        <Param icon={Zap} label={t("Орбитальная скорость", "Orbital velocity")} delay={0.2}
          value={derived.orbital_velocity_kms != null ? `${fmt(derived.orbital_velocity_kms, 1)} ${t("км/с", "km/s")}` : null}
          unit={t("средняя (Земля: 29.8 км/с)", "average (Earth: 29.8 km/s)")} />
        <Param icon={Waves} label={t("Амплитуда луч. скорости", "Radial velocity amplitude")} delay={0.25}
          value={orb.rv_amplitude != null ? `${fmt(orb.rv_amplitude, 2)} ${t("м/с", "m/s")}` : null}
          unit={t("покачивание звезды из-за планеты", "the star's wobble caused by the planet")} />
        <Param icon={Timer} label={t("Глубина транзита", "Transit depth")} delay={0.3}
          value={orb.transit_depth != null ? `${fmt(orb.transit_depth, 3)}%` : null}
          unit={t("ослабление света звезды при прохождении", "the dimming of the star's light during transit")} />
        <Param icon={Timer} label={t("Длительность транзита", "Transit duration")} delay={0.35}
          value={orb.transit_duration != null ? `${fmt(orb.transit_duration, 2)} ${t("ч", "h")}` : null}
          unit={t("время прохождения по диску звезды", "time to cross the star's disc")} />
      </div>

      {/* Дополнительная геометрия */}
      {(orb.a_over_rstar != null || orb.rp_over_rstar != null || orb.impact_parameter != null || orb.arg_periastron != null) && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4">{t("Геометрия системы", "System geometry")}</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm">
            {[
              [t("a / R★ (полуось в радиусах звезды)", "a / R★ (semi-major axis in stellar radii)"), orb.a_over_rstar, 2],
              [t("Rp / R★ (радиус планеты к звезде)", "Rp / R★ (planet radius to star)"), orb.rp_over_rstar, 4],
              [t("Прицельный параметр b", "Impact parameter b"), orb.impact_parameter, 3],
              [t("Аргумент перицентра, °", "Argument of periastron, °"), orb.arg_periastron, 1],
            ].filter(([, v]) => v != null).map(([label, v, d]) => (
              <div key={label}>
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className="text-white font-semibold tabular">{fmt(v, d)}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Текстовое описание */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="panel rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-3">{t("Описание орбиты", "Orbit description")}</h3>
        <div className="space-y-2.5 text-sm text-slate-300 leading-relaxed">
          {orb.period != null && (
            <p>
              {t("Год на этой планете длится", "A year on this planet lasts")} <b className="text-white">{fmt(orb.period, 2)} {t("земных суток", "Earth days")}</b>.
              {orb.period < 1 && t(" Планета проносится вокруг звезды меньше чем за сутки — она буквально прижата к светилу.", " The planet whips around its star in less than a day — it is literally pressed against the star.")}
              {orb.period >= 1 && orb.period < 20 && t(" Это ультракороткий год: звезда огромным диском висит в её небе.", " This is an ultra-short year: the star hangs as a huge disc in its sky.")}
              {orb.period >= 20 && orb.period < 200 && t(" Короче земного года — орбита компактнее нашей.", " Shorter than an Earth year — the orbit is more compact than ours.")}
              {orb.period >= 200 && orb.period < 1000 && t(" Сопоставимо с земным годом.", " Comparable to an Earth year.")}
              {orb.period >= 1000 && t(" Долгий год, как у внешних планет Солнечной системы.", " A long year, like the outer planets of the Solar System.")}
            </p>
          )}
          {a != null && (
            <p>
              {t("Среднее расстояние до звезды —", "The average distance to the star is")} <b className="text-white">{fmt(a, 4)} {t("а.е.", "AU")}</b> ({fmt(a * 149.6, 1)} {t("млн км", "M km")}).
              {" "}{t("Для сравнения: Земля от Солнца — 1 а.е., Меркурий — 0.39 а.е.", "For comparison: Earth is 1 AU from the Sun, Mercury is 0.39 AU.")}
            </p>
          )}
          {orb.eccentricity != null && (
            <p>
              {t("Эксцентриситет", "Eccentricity")} <b className="text-white">{fmt(orb.eccentricity, 3)}</b>{" "}
              {orb.eccentricity < 0.05 && t("— орбита практически круговая, климатические сезоны из-за формы орбиты отсутствуют.", "— the orbit is almost circular, so there are no seasons caused by the orbit's shape.")}
              {orb.eccentricity >= 0.05 && orb.eccentricity < 0.2 && t("— слегка эллиптическая орбита, как у большинства планет.", "— a slightly elliptical orbit, like most planets.")}
              {orb.eccentricity >= 0.2 && orb.eccentricity < 0.5 && t("— заметно вытянутая орбита: расстояние до звезды ощутимо меняется за год.", "— a noticeably stretched orbit: the distance to the star changes markedly over a year.")}
              {orb.eccentricity >= 0.5 && t("— экстремально вытянутая орбита: планета то поджаривается вблизи звезды, то замерзает вдали.", "— an extremely stretched orbit: the planet roasts near the star, then freezes far away.")}
            </p>
          )}
          {derived.tidal_locking === "likely" && (
            <p className="text-amber-300/90">
              {t("Планета, скорее всего, находится в приливном захвате: одна сторона вечно обращена к звезде, другая — в вечной ночи. Жизнь была бы возможна лишь в сумеречной зоне терминатора.", "The planet is most likely tidally locked: one side eternally faces the star, the other lies in perpetual night. Life would only be possible in the twilight zone of the terminator.")}
            </p>
          )}
        </div>
      </motion.div>

      {/* Небо планеты */}
      <SkyFromPlanet star={star} orb={orb} derived={derived} />
    </div>
  );
};

export default OrbitalTab;
