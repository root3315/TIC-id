import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Dices, Clock, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  motion, AnimatePresence, useMotionValue, useMotionTemplate, useTransform,
  animate as fmAnimate,
} from "framer-motion";
import { toast } from "sonner";
import { suggest, searchPlanet, getStats, getRandom, prefetchPlanet } from "@/lib/api";
import { fmt, methodRu, planetClass, tempZone, localHistory, plural, densityOf } from "@/lib/format";
import { getFavorites } from "@/lib/favorites";
import PlanetVisual from "@/components/PlanetVisual";
import { useT } from "@/lib/i18n";

const EXAMPLES = ["Kepler-186 f", "TRAPPIST-1 e", "Proxima Cen b", "K2-18 b", "WASP-12 b"];

const SuggestionRow = ({ s, active, onClick }) => {
  const t = useT();
  const cls = planetClass(s.pl_rade, densityOf(s.pl_bmasse, s.pl_rade));
  const hoverTimer = useRef(null);
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => { hoverTimer.current = setTimeout(() => prefetchPlanet(s.pl_name), 250); }}
      onMouseLeave={() => clearTimeout(hoverTimer.current)}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        active ? "bg-[color:var(--beam-wash)]" : "hover:bg-white/5"
      }`}
      data-testid={`suggestion-${s.pl_name}`}
    >
      <PlanetVisual radius={s.pl_rade} teq={s.pl_eqt} mass={s.pl_bmasse} size={30} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{s.pl_name}</div>
        <div className="text-xs truncate" style={{ color: "var(--ink-3)" }}>
          {s.hostname} · {methodRu(s.discoverymethod)}{s.disc_year ? ` · ${s.disc_year}` : ""}
        </div>
      </div>
      <div className="text-right shrink-0">
        {cls && (
          <div className="text-xs font-medium" style={{ color: cls.color }}>{cls.label}</div>
        )}
        {s.sy_dist != null && (
          <div className="mono text-[11px]" style={{ color: "var(--ink-4)" }}>{fmt(s.sy_dist, 0)} {t("пк", "pc")}</div>
        )}
      </div>
    </button>
  );
};

const ResultCard = ({ r, onOpen, index }) => {
  const t = useT();
  const cls = planetClass(r.pl_rade, densityOf(r.pl_bmasse, r.pl_rade));
  const tz = tempZone(r.pl_eqt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel rounded-xl p-5 text-left hover-lift w-full"
      data-testid={`result-card-${r.pl_name}`}
    >
      <div className="flex items-center gap-4">
        <PlanetVisual radius={r.pl_rade} teq={r.pl_eqt} mass={r.pl_bmasse} size={64} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{r.pl_name}</div>
          <div className="text-xs truncate mt-0.5" style={{ color: "var(--ink-3)" }}>
            {r.hostname} · {methodRu(r.discoverymethod)} · {r.disc_year || "—"}
          </div>
          {/* Цвет остался у точки: он кодирует класс и температуру,
              а текст метки живёт в общей нейтральной шкале. */}
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {cls && (
              <span className="tag tag-word">
                <i className="dot" style={{ background: cls.color }} />{cls.label}
              </span>
            )}
            {tz && (
              <span className="tag tag-word">
                <i className="dot" style={{ background: tz.color }} />{tz.label}
              </span>
            )}
            {r.sy_dist != null && (
              <span className="tag tabular">{fmt(r.sy_dist, 0)} {t("пк", "pc")}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

/** Декоративная планета в hero — чёткий SVG в палитре сайта */
/** Аккреционный диск чёрной дыры: наклонённое вращающееся кольцо плазмы.
    front — нижняя (ближняя к зрителю) половина, рисуется поверх горизонта. */
const BHDisk = ({ front = false }) => (
  <div
    className="absolute"
    style={{
      left: "50%", top: "50%", width: 392, height: 392,
      transform: "translate(-50%,-50%) perspective(1100px) rotateX(76deg)",
      zIndex: front ? 30 : 10,
      clipPath: front ? "inset(50% 0 0 0)" : undefined,
    }}
  >
    <div
      className="absolute inset-0 rounded-full"
      style={{
        background:
          "conic-gradient(from 0deg, rgba(30,27,75,0) 0deg, #312e81 42deg, #6366f1 105deg, #a5b4fc 150deg, #e0f2fe 185deg, #818cf8 232deg, #4338ca 300deg, rgba(30,27,75,0) 360deg)",
        WebkitMask: "radial-gradient(circle, transparent 36%, black 41%, black 64%, transparent 68%)",
        mask: "radial-gradient(circle, transparent 36%, black 41%, black 64%, transparent 68%)",
        animation: "bh-spin 11s linear infinite",
        filter: "blur(1.4px) saturate(1.3)",
      }}
    />
    {/* раскалённый внутренний край диска */}
    <div
      className="absolute inset-0 rounded-full"
      style={{
        background: "conic-gradient(from 0deg, rgba(224,242,254,0), rgba(224,242,254,.85) 130deg, rgba(186,230,253,.95) 190deg, rgba(224,242,254,.35) 260deg, rgba(224,242,254,0))",
        WebkitMask: "radial-gradient(circle, transparent 39%, black 42%, black 47%, transparent 50%)",
        mask: "radial-gradient(circle, transparent 39%, black 42%, black 47%, transparent 50%)",
        animation: "bh-spin 8s linear infinite",
        filter: "blur(1.6px)",
        mixBlendMode: "screen",
      }}
    />
    {/* релятивистский доплер: приближающийся край диска ярче */}
    <div
      className="absolute inset-0 rounded-full"
      style={{
        background: "linear-gradient(90deg, rgba(224,242,254,.55), transparent 46%)",
        WebkitMask: "radial-gradient(circle, transparent 36%, black 41%, black 64%, transparent 68%)",
        mask: "radial-gradient(circle, transparent 36%, black 41%, black 64%, transparent 68%)",
        mixBlendMode: "screen",
        filter: "blur(3px)",
      }}
    />
  </div>
);

/** Сингулярность: чёрная дыра с аккреционным диском в палитре сайта.
    pulse — счётчик проглоченных блоков (вспышка при каждом). */
const HeroArt = ({ pulse = 0, innerRef }) => (
  <div
    ref={innerRef}
    className="relative select-none pointer-events-none"
    style={{ width: 440, height: 440 }}
    aria-hidden="true"
  >
    <style>{`
      @keyframes bh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes bh-drift { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
      @keyframes bh-shimmer { 0%,100% { opacity: .65; } 50% { opacity: 1; } }
      @keyframes bh-twinkle { 0%,100% { opacity: .25; } 50% { opacity: .9; } }
      @keyframes bh-flash {
        0% { opacity: 0; transform: translate(-50%,-50%) scale(.75); }
        30% { opacity: .95; }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1.45); }
      }
      @keyframes bh-gulp {
        0%, 100% { transform: translateY(0) scale(1); }
        35% { transform: translateY(0) scale(1.06); }
        60% { transform: translateY(0) scale(.985); }
      }
    `}</style>
    <div
      className="absolute inset-0"
      style={{ animation: "bh-drift 7s ease-in-out infinite" }}
    >
      <div key={pulse} className="absolute inset-0" style={pulse ? { animation: "bh-gulp .9s ease-out" } : undefined}>
        {/* дальнее свечение */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,.17), rgba(34,211,238,.06) 55%, transparent 72%)" }}
        />

        {/* звёзды вокруг */}
        {[[52, 96, 1.6, 0], [396, 118, 1.2, 1.2], [72, 330, 1.3, 0.6], [388, 320, 1.6, 1.8], [218, 34, 1.1, 2.4]].map(([x, y, r, d]) => (
          <div key={`${x}-${y}`} className="absolute rounded-full bg-indigo-100"
            style={{ left: x, top: y, width: r * 2, height: r * 2, animation: `bh-twinkle ${2.6 + d}s ease-in-out ${d}s infinite` }} />
        ))}

        {/* линзированное фотонное кольцо — ореол вокруг тени */}
        <div
          className="absolute rounded-full"
          style={{
            left: "50%", top: "50%", width: 208, height: 208,
            transform: "translate(-50%,-50%)",
            boxShadow:
              "0 0 26px 6px rgba(165,180,252,.5), 0 0 90px 22px rgba(99,102,241,.24), 0 0 150px 40px rgba(34,211,238,.10), inset 0 0 24px 6px rgba(224,231,255,.4)",
            animation: "bh-shimmer 3.6s ease-in-out infinite",
            zIndex: 15,
          }}
        />

        {/* вспышка при поглощении блока */}
        {pulse > 0 && (
          <div
            className="absolute rounded-full"
            style={{
              left: "50%", top: "50%", width: 230, height: 230,
              border: "2px solid rgba(165,180,252,.9)",
              boxShadow: "0 0 40px 12px rgba(129,140,248,.55)",
              animation: "bh-flash 1.1s ease-out forwards",
              zIndex: 35,
            }}
          />
        )}

        {/* задняя половина диска */}
        <BHDisk />

        {/* горизонт событий — абсолютная чернота */}
        <div
          className="absolute rounded-full"
          style={{
            left: "50%", top: "50%", width: 170, height: 170,
            transform: "translate(-50%,-50%)",
            background: "#000",
            zIndex: 20,
            boxShadow: "inset 0 0 36px 12px #000, 0 0 2px 1px rgba(199,210,254,.55)",
          }}
        />

        {/* передняя половина диска — проходит перед тенью */}
        <BHDisk front />
      </div>
    </div>
  </div>
);

/** Перетаскиваемый блок: можно двигать мышкой, а если бросить в чёрную дыру —
    блок засосёт за горизонт, и через пару секунд он вернётся на место. */
const DraggableBlock = ({ bhRef, canDrag, onSwallow, className = "", outerClassName = "", children }) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // спагеттификация: блок вытягивается ВДОЛЬ направления на дыру, чем ближе — тем сильнее
  const gAngle = useMotionValue(0);       // угол на дыру, градусы
  const gStretch = useMotionValue(1);     // растяжение вдоль этого угла
  const gAcross = useMotionValue(1);      // лёгкое сжатие поперёк (сохранение «объёма»)
  const gShrink = useMotionValue(1);      // общий масштаб (для поглощения/появления)
  const gPull = useMotionValue(0);        // подтягивание ближнего края к дыре
  const gBlur = useMotionValue(0);
  const gDim = useMotionValue(1);
  const gAngleNeg = useTransform(gAngle, (a) => -a);
  const px = useTransform([gAngle, gPull], ([a, p]) => Math.cos((a * Math.PI) / 180) * p);
  const py = useTransform([gAngle, gPull], ([a, p]) => Math.sin((a * Math.PI) / 180) * p);
  // матрица направленного растяжения: R(θ) · S(stretch, across) · R(−θ)
  // живёт на внутреннем элементе, чтобы не конфликтовать с drag-трансформом
  const innerTransform = useMotionTemplate`translate3d(${px}px, ${py}px, 0) rotate(${gAngle}deg) scale(${gStretch}, ${gAcross}) rotate(${gAngleNeg}deg) scale(${gShrink})`;
  const gFilter = useMotionTemplate`blur(${gBlur}px)`;
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  // не начинать перетаскивание с интерактивных элементов (ввод, кнопки, ссылки)
  const guard = (e) => {
    if (e.target.closest("input,button,a,select,textarea,[role='combobox'],[data-no-drag]")) {
      e.stopPropagation();
    }
  };

  const holeDelta = () => {
    const bhEl = bhRef?.current;
    if (!bhEl || !ref.current) return null;
    const bh = bhEl.getBoundingClientRect();
    const me = ref.current.getBoundingClientRect();
    return {
      dx: bh.left + bh.width / 2 - (me.left + me.width / 2),
      dy: bh.top + bh.height / 2 - (me.top + me.height / 2),
    };
  };

  const proximity = (dist) => {
    const R = 420;                                   // радиус влияния гравитации
    return Math.max(0, Math.min(1, (R - dist) / (R - 105)));
  };

  const onDrag = () => {
    const d = holeDelta();
    if (!d) return;
    const dist = Math.hypot(d.dx, d.dy);
    const t = proximity(dist);
    gAngle.set((Math.atan2(d.dy, d.dx) * 180) / Math.PI);
    gStretch.set(1 + 1.25 * t * t);                  // у горизонта тянет более чем вдвое
    gAcross.set(1 - 0.28 * t * t);                   // и слегка сплющивает поперёк
    gPull.set(34 * t * t);                           // ближний край засасывает первым
    gBlur.set(2.2 * t * t);
    gDim.set(1 - 0.15 * t);
  };

  const relax = () => {
    fmAnimate(gStretch, 1, { type: "spring", stiffness: 240, damping: 18 });
    fmAnimate(gAcross, 1, { type: "spring", stiffness: 240, damping: 18 });
    fmAnimate(gPull, 0, { type: "spring", stiffness: 240, damping: 20 });
    fmAnimate(gBlur, 0, { duration: 0.3 });
    fmAnimate(gDim, 1, { duration: 0.3 });
  };

  const springHome = () => {
    relax();
    fmAnimate(x, 0, { type: "spring", stiffness: 300, damping: 25 });
    fmAnimate(y, 0, { type: "spring", stiffness: 300, damping: 25 });
  };

  const onDragEnd = async () => {
    const d = holeDelta();
    if (!d) return springHome();
    const dist = Math.hypot(d.dx, d.dy);
    if (proximity(dist) < 0.55) return springHome();  // растянуло мало — отпускает

    setBusy(true);
    onSwallow?.();
    // сильно растянуло — поглощение: нить утекает в центр, истончаясь до нуля
    const dur = { duration: 1.0, ease: [0.7, 0, 1, 0.55] };
    await Promise.all([
      fmAnimate(x, x.get() + d.dx, dur),
      fmAnimate(y, y.get() + d.dy, dur),
      fmAnimate(gStretch, 3.2, dur),
      fmAnimate(gAcross, 0.04, dur),
      fmAnimate(gShrink, 0.25, dur),
      fmAnimate(gPull, 0, dur),
      fmAnimate(gDim, 0, { duration: 0.85, ease: "easeIn" }),
      fmAnimate(gBlur, 7, dur),
    ]);
    setTimeout(async () => {
      x.set(0); y.set(0); gStretch.set(1); gAcross.set(1); gPull.set(0);
      gShrink.set(0.94); gBlur.set(5); gDim.set(0);
      await Promise.all([
        fmAnimate(gShrink, 1, { duration: 0.9, ease: "easeOut" }),
        fmAnimate(gDim, 1, { duration: 0.9, ease: "easeOut" }),
        fmAnimate(gBlur, 0, { duration: 0.7, ease: "easeOut" }),
      ]);
      setBusy(false);
    }, 2300);
  };

  return (
    <motion.div
      ref={ref}
      drag={canDrag && !busy}
      dragMomentum={false}
      dragElastic={0.16}
      whileDrag={{ zIndex: 60 }}
      onPointerDownCapture={guard}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      style={{ x, y }}
      className={`${canDrag ? "lg:cursor-grab active:lg:cursor-grabbing" : ""} ${outerClassName}`}
    >
      <motion.div className={className}
        style={{ transform: innerTransform, filter: gFilter, opacity: gDim }}>
        {children}
      </motion.div>
    </motion.div>
  );
};

const SearchPage = () => {
  const t = useT();
  // Спецификация, а не витрина: у каждой строки подписан реальный
  // источник данных — он говорит о возможности больше, чем иконка.
  const FEATURES = [
    { source: "NASA · SIMBAD · WIKIPEDIA", title: t("Полная карточка", "Full record"), text: t("400+ полей архива, все обозначения планеты и звезды, текст из Wikipedia", "400+ archive fields, every planet and star designation, Wikipedia text") },
    { source: "DSS2 · 2MASS · WISE", title: t("Снимки поля", "Field imagery"), text: t("Реальное поле звезды из обзоров неба и живой атлас Aladin", "The real star field from sky surveys and the live Aladin atlas") },
    { source: "KOPPARAPU · ESI", title: t("Обитаемость", "Habitability"), text: t("Семь факторов, границы зоны жизни и индекс подобия Земле", "Seven factors, life-zone boundaries and the Earth Similarity Index") },
    { source: "HistGB · ROC-AUC 0.98", title: t("Детектор кандидатов", "Candidate detector"), text: t("Модель, обученная на размеченных кандидатах Kepler, ранжирует живые TOI", "A model trained on labelled Kepler candidates ranks live TOIs") },
    { source: "MAST · BLS · CNN", title: t("Кривые блеска", "Light curves"), text: t("Фотометрия из архива, поиск периода и разбор формы транзита нейросетью", "Archive photometry, period search and transit-shape analysis by a neural net") },
    { source: "GROQ · LLM", title: t("Разбор текстом", "Written analysis"), text: t("Языковая модель объясняет параметры планеты и отвечает на вопросы", "A language model explains the planet's parameters and answers questions") },
  ];
  const LOADING_STAGES = [
    t("Запрос к NASA Exoplanet Archive…", "Querying the NASA Exoplanet Archive…"),
    t("Параллельно: SIMBAD, Wikipedia, система…", "In parallel: SIMBAD, Wikipedia, system…"),
    t("Считаем обитаемость и зону жизни…", "Computing habitability and the life zone…"),
  ];
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("name");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [listResults, setListResults] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [favs, setFavs] = useState([]);
  const navigate = useNavigate();
  const debounceRef = useRef(null);
  const stageTimerRef = useRef(null);
  // чёрная дыра: перетаскивание блоков и «поглощение»
  const bhRef = useRef(null);
  const [canDrag, setCanDrag] = useState(false);
  const [swallows, setSwallows] = useState(0);

  useEffect(() => {
    const upd = () => setCanDrag(window.innerWidth >= 1024);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  const onSwallow = () => {
    setSwallows((n) => n + 1);
    toast(t("Блок пересёк горизонт событий", "The block crossed the event horizon"), {
      description: t("Излучение Хокинга вернёт его через пару секунд", "Hawking radiation will bring it back in a couple of seconds"),
    });
  };

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
    setRecent(localHistory.get());
    setFavs(getFavorites());
    const onFavs = () => setFavs(getFavorites());
    window.addEventListener("exovision-favs", onFavs);
    return () => window.removeEventListener("exovision-favs", onFavs);
  }, []);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    clearInterval(stageTimerRef.current);
  }, []);

  const openPlanet = useCallback((name, data = null) => {
    localHistory.add({ name, ts: Date.now() });
    navigate(`/results?name=${encodeURIComponent(name)}`, data ? { state: { data } } : undefined);
  }, [navigate]);

  const startStagedLoader = () => {
    setLoadingStage(0);
    let i = 0;
    stageTimerRef.current = setInterval(() => {
      i = Math.min(i + 1, LOADING_STAGES.length - 1);
      setLoadingStage(i);
    }, 2400);
  };

  const stopStagedLoader = () => clearInterval(stageTimerRef.current);

  const handleSearch = async (overrideQuery) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) {
      toast.error(t("Введите название планеты, звезды или TIC ID", "Enter a planet name, star name or TIC ID"));
      return;
    }
    setShowSuggest(false);
    setListResults(null);
    setIsLoading(true);
    startStagedLoader();
    try {
      const res = await searchPlanet(searchType === "tic" ? `TIC ${q}` : q, searchType);
      if (res.type === "detail") {
        openPlanet(res.data.name, res.data);
      } else if (res.type === "list") {
        setListResults(res);
        toast.info(t(`Найдено ${res.count} ${plural(res.count, "планета", "планеты", "планет")} — выберите нужную`, `Found ${res.count} ${res.count === 1 ? "planet" : "planets"} — pick one`));
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      if (error.response?.status === 404) {
        const hints = detail?.did_you_mean;
        if (hints?.length) {
          toast.error(t(`Не найдено. Возможно, вы искали: ${hints.slice(0, 3).join(", ")}`, `Not found. Perhaps you meant: ${hints.slice(0, 3).join(", ")}`));
          const sug = await suggest(q).catch(() => null);
          if (sug?.suggestions?.length) {
            setListResults({ count: sug.suggestions.length, results: sug.suggestions });
          }
        } else {
          toast.error(t("Планета не найдена в архиве подтверждённых экзопланет", "Planet not found in the confirmed exoplanet archive"));
        }
      } else {
        toast.error(t("Ошибка поиска. Проверьте, что backend запущен.", "Search error. Make sure the backend is running."));
      }
    } finally {
      stopStagedLoader();
      setIsLoading(false);
    }
  };

  const handleRandom = async () => {
    try {
      const { name } = await getRandom();
      toast.info(t(`Случайная планета: ${name}`, `Random planet: ${name}`));
      openPlanet(name);
    } catch {
      toast.error(t("Не удалось выбрать случайную планету", "Could not pick a random planet"));
    }
  };

  const handleQueryChange = (e) => {
    let value = e.target.value;
    if (searchType === "tic") value = value.replace(/[^0-9]/g, "");
    setQuery(value);
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    if (searchType === "name" && value.trim().length >= 2) {
      debounceRef.current = setTimeout(async () => {
        const res = await suggest(value.trim(), 8).catch(() => null);
        if (res) {
          setSuggestions(res.suggestions);
          setShowSuggest(true);
        }
      }, 180);
    } else {
      setSuggestions([]);
      setShowSuggest(false);
    }
  };

  const handleKeyDown = (e) => {
    if (showSuggest && suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggest(false);
        return;
      }
      if (e.key === "Enter" && activeIdx >= 0) {
        e.preventDefault();
        openPlanet(suggestions[activeIdx].pl_name);
        return;
      }
    }
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="min-h-screen relative overflow-hidden pt-14">
      {/* Атмосферу рисует canvas Starfield — дублировать её
          градиентными пятнами под ним незачем. */}
      <div className="relative z-10 max-w-7xl mx-auto px-5 pt-14 sm:pt-20 pb-16">
        {/* ===== Hero: слева текст и поиск, справа планетная композиция ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
          <div>
            <div>
              <DraggableBlock bhRef={bhRef} canDrag={canDrag} onSwallow={onSwallow} outerClassName="inline-block">
                <div className="label-mono mb-6 flex items-center gap-2.5">
                  <span className="dot" style={{ background: "var(--beam)" }} />
                  <span>NASA Exoplanet Archive<span className="hidden sm:inline"> · pscomppars</span></span>
                  {stats && (
                    <>
                      <span className="hidden sm:inline" style={{ color: "var(--ink-4)" }}>/</span>
                      <span className="hidden sm:inline" style={{ color: "var(--ink-4)" }}>
                        {new Date(stats.updated_at).toLocaleDateString("ru-RU")}
                        {stats.stale && t(` · архив не отвечает, данным ${fmt(stats.age_hours / 24, 1)} сут`,
                          ` · archive not answering, data ${fmt(stats.age_hours / 24, 1)} d old`)}
                      </span>
                    </>
                  )}
                </div>
              </DraggableBlock>
              <DraggableBlock bhRef={bhRef} canDrag={canDrag} onSwallow={onSwallow}>
                <h1 className="text-[40px] sm:text-5xl xl:text-[58px] font-semibold leading-[1.04] mb-5 text-white">
                  {t("Строка в каталоге —", "A row in the catalogue —")}
                  <br className="hidden sm:block" />{" "}
                  {t("это целый мир", "is an entire world")}
                </h1>
              </DraggableBlock>
              <DraggableBlock bhRef={bhRef} canDrag={canDrag} onSwallow={onSwallow} outerClassName="max-w-xl">
                <p className="text-[17px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                  {t("Разворачиваем её в досье: параметры и снимок поля, оценка обитаемости, разбор кривой блеска. По каждой из", "We unfold it into a dossier: parameters and field imagery, a habitability estimate, a light-curve analysis. For each of")}{" "}
                  <span className="text-white tabular font-medium">{stats ? fmt(stats.total_planets, 0) : "6 000+"}</span>{" "}
                  {t("подтверждённых планет.", "confirmed planets.")}
                </p>
              </DraggableBlock>
            </div>

            {/* Поиск */}
            <div className="mt-8 max-w-2xl">
              <DraggableBlock bhRef={bhRef} canDrag={canDrag} onSwallow={onSwallow}
                className="card-glow rounded-xl p-5 sm:p-6">
              {/* Сегментированный переключатель: одна рамка на два состояния,
                  а не две отдельные «таблетки». */}
              <div className="flex items-center gap-3 mb-3.5">
                <div className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid var(--rule)" }}>
                  {[
                    { v: "name", label: t("По названию", "By name") },
                    { v: "tic", label: t("По TIC ID", "By TIC ID") },
                  ].map((opt, i) => (
                    <button
                      key={opt.v}
                      type="button"
                      data-testid={`search-type-${opt.v}`}
                      aria-pressed={searchType === opt.v}
                      onClick={() => { setSearchType(opt.v); setQuery(""); setSuggestions([]); setShowSuggest(false); }}
                      className="px-3.5 py-1.5 text-xs font-medium"
                      style={{
                        background: searchType === opt.v ? "var(--beam-wash)" : "transparent",
                        color: searchType === opt.v ? "var(--beam-hi)" : "var(--ink-3)",
                        borderLeft: i ? "1px solid var(--rule)" : "none",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span className="label-mono ml-auto hidden sm:block" style={{ color: "var(--ink-4)" }}>
                  {t("Enter — искать · ↑↓ — подсказки", "Enter — search · ↑↓ — suggestions")}
                </span>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] pointer-events-none" style={{ color: "var(--ink-3)" }} />
                {searchType === "tic" && (
                  <span className="absolute left-12 top-1/2 -translate-y-1/2 mono text-sm pointer-events-none" style={{ color: "var(--ink-3)" }}>TIC</span>
                )}
                <Input
                  data-testid="search-input"
                  type="text"
                  placeholder={searchType === "name"
                    ? t("Kepler-186 f, TRAPPIST-1, Proxima…", "Kepler-186 f, TRAPPIST-1, Proxima…")
                    : t("Только цифры: 268159861", "Digits only: 268159861")}
                  value={query}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => suggestions.length && setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  autoComplete="off"
                  className={`field w-full h-14 ${searchType === "tic" ? "pl-[86px]" : "pl-11"} pr-4 text-[17px] rounded-lg text-white focus-visible:ring-0 focus-visible:ring-offset-0`}
                />
                <AnimatePresence>
                  {showSuggest && suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 right-0 top-full mt-2 panel-2 rounded-lg overflow-hidden z-30 divide-y divide-white/5"
                      data-testid="suggestions-dropdown"
                    >
                      {suggestions.map((s, i) => (
                        <SuggestionRow key={s.pl_name} s={s} active={i === activeIdx} onClick={() => openPlanet(s.pl_name)} />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Кнопка по ширине текста: сплошная циановая плашка во всю
                  строку перекрикивала бы заголовок. */}
              <div className="flex gap-2.5 mt-3.5">
                <Button
                  data-testid="search-button"
                  onClick={() => handleSearch()}
                  disabled={isLoading}
                  className="btn-beam h-11 px-6 text-[15px] rounded-lg hover:bg-[var(--beam-hi)]"
                >
                  {isLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{LOADING_STAGES[loadingStage]}</>
                  ) : (
                    t("Найти планету", "Find planet")
                  )}
                </Button>
                <Button
                  data-testid="random-button"
                  onClick={handleRandom}
                  disabled={isLoading}
                  variant="ghost"
                  className="btn-quiet h-11 px-4 rounded-lg"
                  title={t("Случайная планета", "Random planet")}
                >
                  <Dices className="w-[18px] h-[18px]" />
                </Button>
              </div>

              {/* Примеры и недавние — внутри панели, компактно */}
              <div className="flex flex-wrap items-center gap-1.5 mt-4">
                <span className="label-mono mr-1.5" style={{ color: "var(--ink-4)" }}>{t("Примеры", "Examples")}</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => openPlanet(example)}
                    className="tag tag-link"
                    data-testid={`example-${example.replace(/\s/g, "-").toLowerCase()}`}
                  >
                    {example}
                  </button>
                ))}
              </div>
              {favs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="label-mono mr-1.5" style={{ color: "var(--ink-4)" }}>{t("Избранное", "Favorites")}</span>
                  {favs.slice(0, 5).map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => openPlanet(f.name)}
                      onMouseEnter={() => prefetchPlanet(f.name)}
                      className="tag tag-link"
                      data-testid={`fav-chip-${f.name}`}
                    >
                      <Star className="w-3 h-3" style={{ color: "#fbbf24" }} fill="#fbbf24" />
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="label-mono mr-1.5 inline-flex items-center gap-1.5" style={{ color: "var(--ink-4)" }}>
                    <Clock className="w-3 h-3" />{t("Недавние", "Recent")}
                  </span>
                  {recent.slice(0, 4).map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => openPlanet(r.name)}
                      className="tag tag-link"
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
              </DraggableBlock>
            </div>
          </div>

          {/* Сингулярность */}
          <div className="hidden lg:block justify-self-center">
            <HeroArt pulse={swallows} innerRef={bhRef} />
            {canDrag && (
              <p className="mono text-center mt-1 select-none text-[11px] lowercase"
                style={{ color: "var(--ink-4)", letterSpacing: "0.02em" }}>
                {t("перетащите блок в дыру", "drag a block into the hole")}
              </p>
            )}
          </div>
        </div>

        {/* ===== Статистика одной строкой ===== */}
        {stats && (
          <div className="mt-12">
            <DraggableBlock bhRef={bhRef} canDrag={canDrag} onSwallow={onSwallow}
              className="panel rounded-xl grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--rule)]">
              {/* Обозначение планеты набирается как в каталоге: капслок
                  из «Proxima Cen b» сделал бы неверное имя. */}
              {[
                [fmt(stats.total_planets, 0), t("подтверждённых планет", "confirmed planets")],
                [fmt(stats.total_hosts, 0), t("планетных систем", "planetary systems")],
                [stats.nearest ? `${fmt(stats.nearest.sy_dist * 3.26, 1)} ${t("св. лет", "ly")}` : "—",
                  t("до ближайшей", "to the nearest"), stats.nearest?.pl_name],
                [stats.year_range?.[1] ?? "—", t("год последних открытий", "year of latest discoveries")],
              ].map(([value, label, name]) => (
                <div key={label} className="px-5 py-4">
                  <div className="text-[26px] font-semibold text-white tabular leading-none tracking-tight">{value}</div>
                  <div className="label-mono mt-2">
                    {label}
                    {name && <span className="normal-case" style={{ color: "var(--ink-2)" }}> · {name}</span>}
                  </div>
                </div>
              ))}
            </DraggableBlock>
          </div>
        )}

        {/* ===== Результаты-список ===== */}
        <AnimatePresence>
          {listResults && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-10"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">
                  {t("Найдено:", "Found:")} {listResults.count} {t(plural(listResults.count, "планета", "планеты", "планет"), listResults.count === 1 ? "planet" : "planets")}
                </h2>
                <button type="button" onClick={() => setListResults(null)} className="text-sm text-slate-400 hover:text-slate-200">
                  {t("Скрыть", "Hide")}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {listResults.results.map((r, i) => (
                  <ResultCard key={r.pl_name} r={r} index={i} onOpen={() => openPlanet(r.pl_name)} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== Что внутри: спецификация ===== */}
        <section className="mt-20">
          <div className="label-mono pb-3" style={{ borderBottom: "1px solid var(--rule)" }}>
            {t("Что показывает досье", "What the dossier shows")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12">
            {FEATURES.map((f) => (
              <div key={f.title} className="py-5" style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                <div className="label-mono" style={{ color: "var(--ink-4)" }}>{f.source}</div>
                <div className="font-semibold text-white text-[15px] mt-2">{f.title}</div>
                <p className="text-sm leading-relaxed mt-1" style={{ color: "var(--ink-3)" }}>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-10 text-xs" style={{ color: "var(--ink-4)" }}>
          {t("Данные: NASA Exoplanet Archive, SIMBAD (CDS), Wikipedia, CDS hips2fits, MAST. Открытые источники, без ключей доступа.", "Data: NASA Exoplanet Archive, SIMBAD (CDS), Wikipedia, CDS hips2fits, MAST. Open sources, no access keys.")}
        </p>
      </div>
    </div>
  );
};

export default SearchPage;
