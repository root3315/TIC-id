import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Lightbulb } from "lucide-react";
import { useT } from "@/lib/i18n";

const FACTS = [
  {
    ru: "Свету от TRAPPIST-1 нужно 41 год, чтобы долететь до Земли, — а первым радиопередачам человечества уже больше 100 лет.",
    en: "Light from TRAPPIST-1 takes 41 years to reach Earth — yet humanity's first radio broadcasts are already over 100 years old.",
  },
  {
    ru: "У планеты HD 189733 b, вероятно, идут дожди из расплавленного стекла — боком, при ветре 8 700 км/ч.",
    en: "On HD 189733 b it probably rains molten glass — sideways, in winds of 8,700 km/h.",
  },
  {
    ru: "KELT-9 b горячее многих звёзд: днём на ней ~4 300 °C, и её атмосфера буквально испаряется.",
    en: "KELT-9 b is hotter than many stars: ~4,300 °C on its dayside, and its atmosphere is literally evaporating.",
  },
  {
    ru: "На 55 Cancri e год длится всего 18 часов, а поверхность может быть покрыта океаном лавы.",
    en: "On 55 Cancri e a year lasts just 18 hours, and its surface may be covered by an ocean of lava.",
  },
  {
    ru: "Kepler-16 b обращается сразу вокруг двух звёзд — как Татуин из «Звёздных войн».",
    en: "Kepler-16 b orbits two stars at once — like Tatooine from Star Wars.",
  },
  {
    ru: "Красные карлики живут триллионы лет — их планеты получат в тысячи раз больше времени на развитие жизни, чем Земля.",
    en: "Red dwarfs live for trillions of years — their planets get thousands of times more time for life to develop than Earth.",
  },
  {
    ru: "Первая экзопланета у солнцеподобной звезды (51 Pegasi b) была открыта только в 1995 году — Нобелевская премия за неё пришла в 2019-м.",
    en: "The first exoplanet around a Sun-like star (51 Pegasi b) was only discovered in 1995 — its Nobel Prize came in 2019.",
  },
  {
    ru: "Транзитный метод замечает планету по падению яркости звезды всего на сотые доли процента.",
    en: "The transit method spots a planet from a drop in the star's brightness of just hundredths of a percent.",
  },
  {
    ru: "У планеты WASP-12 b такая низкая плотность и близкая орбита, что звезда вытягивает её в форму яйца.",
    en: "WASP-12 b has such low density and such a close orbit that its star stretches it into an egg shape.",
  },
  {
    ru: "В нашей Галактике планет, вероятно, больше, чем звёзд, — в среднем больше одной на каждую.",
    en: "Our Galaxy probably has more planets than stars — on average more than one per star.",
  },
  {
    ru: "Алмазная планета? У 55 Cancri e так много углерода, что треть её массы может быть алмазом.",
    en: "A diamond planet? 55 Cancri e has so much carbon that a third of its mass could be diamond.",
  },
  {
    ru: "Некоторые «планеты-сироты» летят сквозь Галактику без звезды — их находят по гравитационному микролинзированию.",
    en: "Some 'rogue planets' drift through the Galaxy without a star — they are found through gravitational microlensing.",
  },
  {
    ru: "GJ 1214 b — «водный мир»: значительная часть её массы может быть горячим паром и экзотическими формами льда.",
    en: "GJ 1214 b is a 'water world': a large part of its mass may be hot vapor and exotic forms of ice.",
  },
  {
    ru: "Проксима Центавра b — ближайшая к нам экзопланета: всего 4,2 световых года, зонд на 20% скорости света долетел бы за ~21 год.",
    en: "Proxima Centauri b is the closest exoplanet to us: just 4.2 light-years — a probe at 20% of light speed would reach it in ~21 years.",
  },
];

/** Мини-система: звезда и три планеты на CSS-орбитах */
const OrbitLoader = () => (
  <div className="ls-system" aria-hidden="true">
    <div className="ls-star" />
    {[0, 1, 2].map((i) => (
      <div key={i} className={`ls-orbit ls-orbit-${i}`}>
        <div className={`ls-dot ls-dot-${i}`} />
      </div>
    ))}
  </div>
);

const LoadingScreen = ({ title, stages, stage }) => {
  const t = useT();
  const [factIdx, setFactIdx] = useState(() => Math.floor(Math.random() * FACTS.length));

  useEffect(() => {
    const t = setInterval(() => setFactIdx((i) => (i + 1) % FACTS.length), 5000);
    return () => clearInterval(t);
  }, []);

  const progress = Math.min(95, ((stage + 0.7) / stages.length) * 100);

  return (
    <div className="min-h-screen pt-20 pb-8 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card-glow rounded-3xl px-6 py-6 sm:px-9 sm:py-7 max-w-lg w-full"
      >
        {/* мини-система в 0,8 размера: карточка не упирается в края окна */}
        <div className="flex justify-center -my-3 scale-[0.8]">
          <OrbitLoader />
        </div>
        <h2 className="text-2xl font-bold text-white text-center mb-1">{title}</h2>
        <p className="text-xs text-slate-500 text-center mb-5">
          {t("собираем всё, что человечество знает об этой планете", "gathering everything humanity knows about this planet")}
        </p>

        {/* Этапы */}
        <div className="space-y-2 mb-4">
          {stages.map((s, i) => {
            const done = i < stage;
            const active = i === stage;
            return (
              <motion.div
                key={s}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: done || active ? 1 : 0.4, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3"
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                    done
                      ? "bg-emerald-500/20 border-emerald-400/60"
                      : active
                        ? "border-cyan-400/60 bg-cyan-500/10"
                        : "border-slate-600/50"
                  }`}
                >
                  {done ? (
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                  ) : active ? (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                </span>
                <span className={`text-sm ${done ? "text-slate-400 line-through decoration-slate-600" : active ? "text-white" : "text-slate-500"}`}>
                  {s}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Прогресс */}
        <div className="h-1.5 overflow-hidden mb-5" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
          <motion.div
            className="h-full" style={{ background: "var(--beam)", borderRadius: 2 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </div>

        {/* Факт */}
        <div className="glass rounded-2xl px-4 py-3 min-h-[84px]">
          <div className="flex items-center gap-2 text-amber-300/90 text-xs font-semibold uppercase tracking-wider mb-1.5">
            <Lightbulb className="w-3.5 h-3.5" /> {t("Знаете ли вы?", "Did you know?")}
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={factIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              className="text-sm text-slate-300 leading-relaxed"
            >
              {t(FACTS[factIdx].ru, FACTS[factIdx].en)}
            </motion.p>
          </AnimatePresence>
        </div>

        <p className="text-[11px] text-slate-600 text-center mt-3">
          {t("Первый запрос — 10–20 секунд (5 внешних источников), повторные открываются мгновенно", "First request — 10–20 seconds (5 external sources); repeat requests open instantly")}
        </p>
      </motion.div>
    </div>
  );
};

export default LoadingScreen;
