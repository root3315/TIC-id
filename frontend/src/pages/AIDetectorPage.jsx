import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Radar, Sparkles, Loader2, TrendingUp, ExternalLink, FlaskConical,
  Activity, CheckCircle2, AlertTriangle, Telescope, Waves, Info, Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";
import { getMlInfo, mlClassify, getMlToi, getLightcurve } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useT } from "@/lib/i18n";

const probColor = (p) => (p >= 0.7 ? "#22c55e" : p >= 0.45 ? "#eab308" : p >= 0.25 ? "#f97316" : "#ef4444");

const LC_STAGES = [
  ["Ищем наблюдения в архиве MAST…", "Searching for observations in the MAST archive…"],
  ["Скачиваем кривые блеска (первый раз — до пары минут)…", "Downloading light curves (first time — up to a couple of minutes)…"],
  ["Складываем сегменты и убираем тренды…", "Stitching segments and removing trends…"],
  ["Ищем период (BLS) и фолдим транзиты…", "Searching for the period (BLS) and folding transits…"],
  ["Считаем вердикты нейросети и проверки…", "Computing neural network verdicts and vetting checks…"],
  ["Тяжёлая цель TESS: сегментов много, MAST не спешит — держим связь, повторный запрос будет мгновенным…", "Heavy TESS target: many segments and MAST is slow — staying connected, a repeat request will be instant…"],
];

const MANUAL_FIELDS = [
  { key: "period", label: "Период, сут", label_en: "Period, days", ph: "напр. 3.52", ph_en: "e.g. 3.52" },
  { key: "duration", label: "Длительность транзита, ч", label_en: "Transit duration, h", ph: "напр. 2.8", ph_en: "e.g. 2.8" },
  { key: "depth", label: "Глубина, ppm", label_en: "Depth, ppm", ph: "напр. 500", ph_en: "e.g. 500" },
  { key: "prad", label: "Радиус, R⊕", label_en: "Radius, R⊕", ph: "напр. 1.9", ph_en: "e.g. 1.9" },
  { key: "snr", label: "Сигнал/шум", label_en: "Signal/noise", ph: "напр. 20", ph_en: "e.g. 20" },
  { key: "teq", label: "T кандидата, K", label_en: "Candidate T, K", ph: "напр. 800", ph_en: "e.g. 800" },
  { key: "insol", label: "Инсоляция, S⊕", label_en: "Insolation, S⊕", ph: "напр. 150", ph_en: "e.g. 150" },
  { key: "impact", label: "Прицельный параметр", label_en: "Impact parameter", ph: "0…1", ph_en: "0…1" },
  { key: "steff", label: "T звезды, K", label_en: "Star T, K", ph: "напр. 5700", ph_en: "e.g. 5700" },
  { key: "slogg", label: "log g звезды", label_en: "Star log g", ph: "напр. 4.4", ph_en: "e.g. 4.4" },
  { key: "srad", label: "Радиус звезды, R☉", label_en: "Star radius, R☉", ph: "напр. 1.0", ph_en: "e.g. 1.0" },
  { key: "mag", label: "Зв. величина", label_en: "Magnitude", ph: "напр. 13.5", ph_en: "e.g. 13.5" },
];

const PRESETS = [
  { name: "Горячий юпитер", name_en: "Hot Jupiter", values: { period: 3.2, duration: 3.1, depth: 9500, prad: 12.5, snr: 120, teq: 1400, insol: 1500, impact: 0.3, steff: 5900, slogg: 4.4, srad: 1.1, mag: 12 } },
  { name: "Суперземля у M-карлика", name_en: "Super-Earth around an M dwarf", values: { period: 9.8, duration: 1.6, depth: 1800, prad: 1.6, snr: 25, teq: 480, insol: 12, impact: 0.3, steff: 3600, slogg: 4.8, srad: 0.4, mag: 13.5 } },
  { name: "Землеподобная в зоне обитаемости", name_en: "Earth-like in the habitable zone", values: { period: 130, duration: 6.2, depth: 180, prad: 1.3, snr: 12, teq: 265, insol: 1.1, impact: 0.2, steff: 5100, slogg: 4.55, srad: 0.8, mag: 14 } },
  { name: "Подозрение на двойную", name_en: "Suspected eclipsing binary", values: { period: 1.4, duration: 4.5, depth: 60000, prad: 26, snr: 400, teq: 1800, steff: 6300, slogg: 4.2, srad: 1.4, mag: 12.5 } },
];

const ChartTip = ({ active, payload, xLabel, xUnit = "" }) => {
  const t = useT();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="panel-2 rounded-md px-3 py-2 text-xs">
      <div className="text-slate-400">{xLabel ?? t("фаза", "phase")}: <span className="text-white tabular">{p.p ?? p.t}{xUnit}</span></div>
      <div className="text-slate-400">{t("поток", "flux")}: <span className="text-white tabular">{p.f}</span></div>
    </div>
  );
};

const CheckRow = ({ label, value, ok, warn }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 gap-3">
    <span className="text-sm text-slate-400">{label}</span>
    <span className={`text-sm font-medium tabular text-right ${warn ? "text-orange-300" : ok ? "text-emerald-300" : "text-white"}`}>
      {value}
    </span>
  </div>
);

const AIDetectorPage = () => {
  const t = useT();
  const [searchParams] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [toi, setToi] = useState(null);
  const [toiLoading, setToiLoading] = useState(true);
  const [toiShown, setToiShown] = useState(10);

  // Кривая блеска
  const [lcTarget, setLcTarget] = useState(searchParams.get("target") || "");
  const [lcPeriod, setLcPeriod] = useState(searchParams.get("period") || "");
  const [lcData, setLcData] = useState(null);
  const [lcLoading, setLcLoading] = useState(false);
  const [lcStage, setLcStage] = useState(0);
  const lcRef = useRef(null);
  const lcTimer = useRef(null);
  const autoRan = useRef(false);

  // Ручная проверка
  const [form, setForm] = useState({});
  const [manualResult, setManualResult] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);

  // Охота на планеты: глубокая проверка топ-кандидатов по реальным кривым
  const [huntN, setHuntN] = useState(3);
  const [huntRunning, setHuntRunning] = useState(false);
  const [huntProgress, setHuntProgress] = useState(null); // {i, total, label}
  const [huntResults, setHuntResults] = useState([]);
  const [huntQuery, setHuntQuery] = useState("");         // своя цель для охоты
  const [huntPeriod, setHuntPeriod] = useState("");
  const huntStop = useRef(false);

  useEffect(() => {
    getMlInfo().then(setInfo).catch(() => {});
    getMlToi({ limit: 40 })
      .then(setToi)
      .catch(() => toast.error(t("Рейтинг TOI недоступен — каталог ещё загружается, обновите через минуту", "TOI ranking unavailable — the catalog is still loading, refresh in a minute")))
      .finally(() => setToiLoading(false));
    return () => clearInterval(lcTimer.current);
  }, []);

  const runLightcurve = useCallback(async (target, period) => {
    if (!target?.trim()) {
      toast.error(t("Укажите цель: TIC, KIC или имя звезды", "Enter a target: TIC, KIC or star name"));
      return;
    }
    // принимаем и запятую, и точку как десятичный разделитель
    const p = period ? parseFloat(String(period).replace(",", ".")) : null;
    if (period && (!Number.isFinite(p) || p <= 0)) {
      toast.error(t("Период не распознан — введите число, например 6.25 или 6,25", "Period not recognized — enter a number, e.g. 6.25 or 6,25"));
      return;
    }
    setLcLoading(true);
    setLcData(null);
    setLcStage(0);
    let s = 0;
    lcTimer.current = setInterval(() => {
      s = Math.min(s + 1, LC_STAGES.length - 1);
      setLcStage(s);
    }, 6000);
    try {
      const res = await getLightcurve(target.trim(), p);
      setLcData(res);
    } catch (e) {
      toast.error(e.response?.data?.detail || t("Не удалось получить кривую блеска", "Failed to fetch the light curve"));
    } finally {
      clearInterval(lcTimer.current);
      setLcLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!autoRan.current && searchParams.get("target")) {
      autoRan.current = true;
      runLightcurve(searchParams.get("target"), searchParams.get("period"));
    }
  }, [searchParams, runLightcurve]);

  const checkFromToi = (r) => {
    const target = `TIC ${r.tid}`;
    setLcTarget(target);
    setLcPeriod(r.period ? String(r.period) : "");
    lcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    runLightcurve(target, r.period);
  };

  /** Прогоняет один список целей через полный пайплайн кривых, добавляя карточки-досье */
  const huntThrough = async (picks, { reset = false } = {}) => {
    if (!picks.length || huntRunning) return;
    huntStop.current = false;
    setHuntRunning(true);
    if (reset) setHuntResults([]);
    const fresh = [];
    for (let i = 0; i < picks.length; i++) {
      if (huntStop.current) break;
      const p = picks[i];
      setHuntProgress({ i: i + 1, total: picks.length, label: p.label });
      try {
        const res = await getLightcurve(p.target, p.period);
        fresh.push({ meta: p, lc: res });
      } catch (e) {
        fresh.push({ meta: p, error: e.response?.data?.detail || t("не удалось получить кривую", "failed to fetch the curve") });
      }
      // новые результаты — сверху
      setHuntResults((prev) => [...fresh.slice().reverse(), ...(reset ? [] : prev)]);
    }
    setHuntProgress(null);
    setHuntRunning(false);
    return fresh;
  };

  /** Охота по топ-N очереди TESS */
  const runHunt = async () => {
    if (!toi?.results?.length) return;
    const picks = toi.results.slice(0, huntN).map((r) => ({
      label: `TOI-${r.toi}`, target: `TIC ${r.tid}`, period: r.period,
      toi: r.toi, tid: r.tid, exofop: r.exofop, radius: r.radius,
      period_val: r.period, tabular: r.probability,
    }));
    const done = await huntThrough(picks, { reset: true });
    if (done && !huntStop.current && done.length) {
      const strong = done.filter((x) => huntVerdict(x).kind === "strong").length;
      toast.success(t(`Охота завершена: сильных кандидатов ${strong} из ${done.length}`, `Hunt complete: ${strong} strong candidates out of ${done.length}`));
    }
  };

  /** Охота по своей цели (TIC / KIC / имя звезды) */
  const runHuntCustom = async () => {
    const q = huntQuery.trim();
    if (!q) { toast.error(t("Введите цель: TIC, KIC или имя звезды", "Enter a target: TIC, KIC or star name")); return; }
    const p = huntPeriod ? parseFloat(huntPeriod.replace(",", ".")) : null;
    if (huntPeriod && (!Number.isFinite(p) || p <= 0)) {
      toast.error(t("Период не распознан — например 6.25 или 6,25", "Period not recognized — e.g. 6.25 or 6,25")); return;
    }
    await huntThrough([{ label: q, target: q, period: p, custom: true }]);
    setHuntQuery(""); setHuntPeriod("");
  };

  /** Совмещаем три мнения: табличная модель + нейросеть формы + классический вэттинг */
  const huntVerdict = (entry) => {
    if (entry.error) return { kind: "error", label: t("ошибка данных", "data error"), color: "#94a3b8" };
    const f = entry.lc?.folded || {};
    const checks = f.checks || {};
    const probs = f.nn_probs || {};
    const flags = checks.v_shaped || checks.secondary_significant || f.odd_even?.suspicious;
    const pTab = entry.meta.tabular ?? 0;
    const pNN = probs.planet ?? 0;
    if ((probs.eclipsing_binary ?? 0) > pNN || (flags && pNN < 0.6))
      return { kind: "fp", label: t("похоже на ложноположительный", "looks like a false positive"), color: "#f87171" };
    if (pNN >= 0.7 && !flags && (checks.snr ?? 0) >= 7 && (entry.meta.custom || pTab >= 0.8))
      return { kind: "strong", label: t("сильный кандидат", "strong candidate"), color: "#34d399" };
    if (pNN >= 0.5 && !flags)
      return { kind: "ok", label: t("перспективный, нужны данные", "promising, needs more data"), color: "#fbbf24" };
    return { kind: "weak", label: t("слабый сигнал — вывод ненадёжен", "weak signal — verdict unreliable"), color: "#fb923c" };
  };

  const runManual = async (values = form) => {
    const payload = {};
    Object.entries(values).forEach(([k, v]) => {
      const n = parseFloat(String(v).replace(",", "."));
      if (!Number.isNaN(n)) payload[k] = n;
    });
    if (Object.keys(payload).length < 3) {
      toast.error(t("Заполните хотя бы 3 параметра", "Fill in at least 3 parameters"));
      return;
    }
    setManualLoading(true);
    try {
      const res = await mlClassify(payload);
      setManualResult(res);
    } catch (e) {
      toast.error(e.response?.data?.detail || t("Модель недоступна", "Model unavailable"));
    } finally {
      setManualLoading(false);
    }
  };

  const applyPreset = (p) => {
    const vals = Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, String(v)]));
    setForm(vals);
    runManual(vals);
  };

  const metrics = info?.tabular?.metrics;
  const folded = lcData?.folded;

  return (
    <div className="min-h-screen pt-14 pb-16">
      <div className="max-w-7xl mx-auto px-4 pt-8 space-y-8">
        {/* Заголовок */}
        <div>
          <div className="label-mono mb-3">Kepler KOI · TESS TOI · MAST</div>
          <h1 className="text-[34px] sm:text-[40px] font-semibold text-white leading-none">{t("AI-детектор экзопланет", "AI Exoplanet Detector")}</h1>
          <p className="mt-3 max-w-3xl" style={{ color: "var(--ink-2)" }}>
            {t(
              <>Две локальные модели: классификатор, обученный на {metrics ? fmt(metrics.n_train + metrics.n_test, 0) : "7 500+"} размеченных
              кандидатах Kepler, и нейросеть, читающая форму транзита в реальных кривых блеска TESS и Kepler.</>,
              <>Two local models: a classifier trained on {metrics ? fmt(metrics.n_train + metrics.n_test, 0) : "7,500+"} labeled
              Kepler candidates, and a neural network that reads transit shape in real TESS and Kepler light curves.</>
            )}
          </p>
          {info && (
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="tag tag-word" style={{ color: "#6ee7b7", borderColor: "rgba(52,211,153,.4)" }}>
                ROC-AUC {metrics?.roc_auc ?? "—"} {t("на отложенной выборке", "on the held-out set")}
              </span>
              <span className="tag tag-word">
                {t("точность", "accuracy")} {metrics ? `${fmt(metrics.accuracy * 100, 1)}%` : "—"}
              </span>
              <span className="tag tag-word">
                {info.lightcurve?.cnn ? t("CNN формы транзита", "transit-shape CNN") : t("нейросеть формы", "shape neural network")}: {info.lightcurve
                  ? `${fmt(info.lightcurve.accuracy * 100, 1)}% ${info.lightcurve.real_data ? t("(реальные кривые Kepler)", "(real Kepler curves)") : t("(синт. тест)", "(synthetic test)")}`
                  : "—"}
              </span>
              <span className="tag tag-word">
                {t("работает полностью локально", "runs fully locally")}
              </span>
            </div>
          )}
        </div>

        {/* ===== Анализ кривой блеска ===== */}
        <motion.div
          ref={lcRef}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="card-glow rounded-xl p-6 sm:p-8 scroll-mt-20"
        >
          <div className="flex items-center gap-2.5 mb-1">
            <Waves className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            <h2 className="text-xl font-semibold text-white">{t("Кривая блеска: скачать и проверить", "Light curve: download and check")}</h2>
          </div>
          <p className="text-sm text-slate-500 mb-5">
            {t(
              "Реальные фотометрические данные из архива MAST. Укажите цель (TIC 12345678, KIC, имя звезды) — получите сложенную кривую, классические проверки вэттинга и вердикт нейросети. Период можно не указывать: алгоритм BLS найдёт его сам.",
              "Real photometric data from the MAST archive. Enter a target (TIC 12345678, KIC, star name) — get a folded curve, classical vetting checks and a neural network verdict. The period is optional: the BLS algorithm will find it itself."
            )}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={lcTarget}
              onChange={(e) => setLcTarget(e.target.value)}
              placeholder={t("Цель: TIC 307210830, Kepler-10, WASP-12…", "Target: TIC 307210830, Kepler-10, WASP-12…")}
              className="flex-1 h-11 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-xl"
              data-testid="lc-target"
            />
            <Input
              value={lcPeriod}
              onChange={(e) => setLcPeriod(e.target.value)}
              placeholder={t("Период, сут (пусто — найдёт BLS)", "Period, days (empty — BLS will find it)")}
              inputMode="decimal"
              className="sm:w-60 h-11 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-xl"
              data-testid="lc-period"
            />
            <Button
              onClick={() => runLightcurve(lcTarget, lcPeriod)}
              disabled={lcLoading}
              className="btn-beam h-11 px-6 rounded-lg"
              data-testid="lc-run"
            >
              {lcLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Telescope className="w-4 h-4 mr-2" />}
              {t("Проанализировать", "Analyze")}
            </Button>
          </div>

          {lcLoading && (
            <div className="mt-6 flex items-center gap-3 text-sm text-slate-400">
              <div className="ls-system" style={{ width: 54, height: 54 }}>
                <div className="ls-star" style={{ width: 12, height: 12, margin: -6 }} />
                <div className="ls-orbit ls-orbit-0" style={{ width: 36, height: 36, margin: -18 }}>
                  <div className="ls-dot ls-dot-2" style={{ width: 6, height: 6 }} />
                </div>
              </div>
              {t(LC_STAGES[lcStage][0], LC_STAGES[lcStage][1])}
            </div>
          )}

          <AnimatePresence>
            {lcData && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-6">
                <div className="text-sm text-slate-400">
                  <b className="text-white">{lcData.target}</b> · {lcData.source} · {fmt(lcData.n_points, 0)} {t("точек", "points")} ·
                  {t("каденция", "cadence")} {lcData.cadence_min} {t("мин", "min")} · {t("охват", "span")} {fmt(lcData.days_span, 0)} {t("сут", "days")}
                </div>

                {/* Найденный BLS период */}
                {lcData.bls && (
                  <div className="panel rounded-xl p-5 border-l-2 border-l-cyan-400/60">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="text-sm text-slate-300">
                        {t("Период найден автоматически (BLS):", "Period found automatically (BLS):")}{" "}
                        <b className="text-cyan-300 tabular">{fmt(lcData.bls.best_period, 5)} {t("сут", "days")}</b>
                      </span>
                      <span className="tag">
                        {t("значимость SDE", "SDE significance")} {fmt(lcData.bls.sde, 1)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {t("глубина", "depth")} ≈ {fmt(lcData.bls.depth_ppm, 0)} ppm · {t("длительность", "duration")} ≈ {fmt(lcData.bls.duration_h, 1)} {t("ч", "h")}
                        {lcData.bls.refined && ` · ${t("уточнено по полной каденции", "refined at native cadence")}`}
                        {lcData.bls.max_period && ` · ${t("искали до", "searched up to")} ${fmt(lcData.bls.max_period, 0)} ${t("сут", "d")}`}
                      </span>
                    </div>
                    {lcData.bls.peaks?.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <span className="text-xs text-slate-500">{t("Другие пики периодограммы:", "Other periodogram peaks:")}</span>
                        {lcData.bls.peaks.slice(1).map((pk) => (
                          <button
                            key={pk.period}
                            type="button"
                            onClick={() => {
                              setLcPeriod(String(pk.period));
                              runLightcurve(lcTarget, pk.period);
                            }}
                            className="tag tag-link"
                            title={t(`Сложить по периоду ${pk.period} сут`, `Fold by period ${pk.period} days`)}
                          >
                            {fmt(pk.period, 4)} {t("сут", "days")} (SDE {fmt(pk.sde, 1)})
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-3" style={{ width: "100%", height: 140 }}>
                      <ResponsiveContainer>
                        <ComposedChart data={lcData.bls.periodogram} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                          <XAxis dataKey="P" type="number" scale="log" domain={["dataMin", "dataMax"]}
                            ticks={[0.3, 1, 3, 10, 30]}
                            stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }}
                            tickFormatter={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(1))}
                            label={{ value: t("период, сут (лог)", "period, days (log)"), position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 10 }} />
                          <YAxis stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }} width={44} />
                          <Tooltip content={({ active, payload }) => active && payload?.length ? (
                            <div className="panel-2 rounded-md px-3 py-2 text-xs">
                              <div className="text-slate-400">P: <span className="text-white tabular">{payload[0].payload.P} {t("сут", "days")}</span></div>
                              <div className="text-slate-400">{t("значимость", "significance")}: <span className="text-white tabular">{payload[0].payload.power}σ</span></div>
                            </div>
                          ) : null} />
                          <Line dataKey="power" stroke="#22d3ee" strokeWidth={1.4} dot={false} isAnimationActive={false} />
                          <ReferenceLine x={lcData.bls.best_period} stroke="#f472b6" strokeDasharray="4 4" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Сырая кривая */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">{t("Кривая блеска (весь ряд)", "Light curve (full series)")}</div>
                  <div style={{ width: "100%", height: 200 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={lcData.raw} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]}
                          stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }}
                          label={{ value: t("сутки", "days"), position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 10 }} />
                        <YAxis domain={["auto", "auto"]} stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }} width={54} />
                        <Tooltip content={<ChartTip xLabel={t("день", "day")} />} />
                        <Scatter dataKey="f" fill="#38bdf8" opacity={0.5} shape={(p) => <circle cx={p.cx} cy={p.cy} r={1} fill="#38bdf8" opacity={0.55} />} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {folded && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Сложенная кривая */}
                      <div>
                        <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                          {t("Сложенная по периоду", "Folded by period")} {fmt(folded.period_days, 4)} {t("сут", "days")}
                        </div>
                        <div style={{ width: "100%", height: 260 }}>
                          <ResponsiveContainer>
                            <ComposedChart margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                              <XAxis dataKey="p" type="number" domain={[-0.5, 0.5]} ticks={[-0.4, -0.2, 0, 0.2, 0.4]}
                                stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }}
                                label={{ value: t("фаза", "phase"), position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 10 }} />
                              <YAxis domain={["auto", "auto"]} stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }} width={54} />
                              <Tooltip content={<ChartTip />} />
                              <Scatter data={folded.scatter} dataKey="f" isAnimationActive={false}
                                shape={(p) => <circle cx={p.cx} cy={p.cy} r={1} fill="#64748b" opacity={0.4} />} />
                              <Line data={folded.bins} dataKey="f" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
                              <ReferenceLine x={0} stroke="#f472b6" strokeDasharray="4 4" opacity={0.5} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      {/* Крупный план транзита */}
                      <div>
                        <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                          {t("Крупный план транзита (вход нейросети)", "Transit close-up (neural network input)")}
                        </div>
                        <div style={{ width: "100%", height: 260 }}>
                          <ResponsiveContainer>
                            <ComposedChart data={folded.local_bins} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                              <XAxis dataKey="p" type="number" domain={["dataMin", "dataMax"]}
                                stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }}
                                label={{ value: t("часы от центра транзита", "hours from transit center"), position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 10 }} />
                              <YAxis domain={["auto", "auto"]} stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }} width={54} />
                              <Tooltip content={<ChartTip xLabel={t("часы", "hours")} xUnit={t(" ч", " h")} />} />
                              <Line dataKey="f" stroke="#a78bfa" strokeWidth={2} dot={{ r: 1.5, fill: "#a78bfa" }} isAnimationActive={false} />
                              <ReferenceLine x={0} stroke="#f472b6" strokeDasharray="4 4" opacity={0.5} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    {/* Вердикты */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                      <div className="panel rounded-xl p-5">
                        <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" style={{ color: "var(--ink-3)" }} /> {t("Нейросеть о форме сигнала", "Neural network on signal shape")}
                        </div>
                        {folded.nn_probs?.planet != null ? (
                          <>
                            {[
                              [t("Планетный транзит", "Planetary transit"), folded.nn_probs.planet, "#22c55e"],
                              [t("Затменная двойная", "Eclipsing binary"), folded.nn_probs.eclipsing_binary, "#f97316"],
                              [t("Нет транзита", "No transit"), folded.nn_probs.no_transit, "#64748b"],
                            ].map(([label, v, color]) => (
                              <div key={label} className="mb-2.5">
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-slate-400">{label}</span>
                                  <span className="text-white tabular">{fmt(v * 100, 1)}%</span>
                                </div>
                                <div className="h-1.5" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
                                  <div className="h-full" style={{ width: `${v * 100}%`, background: color, borderRadius: 2 }} />
                                </div>
                              </div>
                            ))}
                            <p className="text-xs text-slate-400 mt-3">{folded.nn_verdict}</p>
                          </>
                        ) : (
                          <p className="text-sm text-slate-500">{t("Нейросеть не загружена", "Neural network not loaded")}</p>
                        )}
                      </div>

                      <div className="panel rounded-xl p-5">
                        <div className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                          <Activity className="w-4 h-4" style={{ color: "var(--ink-3)" }} /> {t("Классические проверки", "Classical checks")}
                        </div>
                        <CheckRow label={t("Глубина транзита", "Transit depth")} value={`${fmt(folded.checks.depth_ppm, 0)} ppm`} />
                        <CheckRow label={t("Значимость (SNR)", "Significance (SNR)")} value={fmt(folded.checks.snr, 1)} warn={folded.checks.snr < 7} />
                        {folded.checks.duration_hours != null && (
                          <CheckRow label={t("Длительность", "Duration")} value={`${fmt(folded.checks.duration_hours, 2)} ${t("ч", "h")}`} />
                        )}
                        <CheckRow label={t("Плоское дно (доля)", "Flat bottom (ratio)")} value={fmt(folded.checks.flat_bottom_ratio, 2)}
                          warn={folded.checks.v_shaped} />
                        <CheckRow label={t("Вторичное затмение", "Secondary eclipse")}
                          value={folded.checks.secondary_significant ? t(`есть, ${fmt(folded.checks.secondary_depth_ppm, 0)} ppm`, `yes, ${fmt(folded.checks.secondary_depth_ppm, 0)} ppm`) : t("не найдено", "not found")}
                          ok={!folded.checks.secondary_significant} warn={folded.checks.secondary_significant} />
                        <CheckRow label={t("Чёт/нечёт транзиты", "Odd/even transits")}
                          value={folded.odd_even.suspicious ? t(`разные (${fmt(folded.odd_even.diff_pct, 0)}%)`, `differ (${fmt(folded.odd_even.diff_pct, 0)}%)`) : t("совпадают", "match")}
                          ok={!folded.odd_even.suspicious} warn={folded.odd_even.suspicious} />
                        {folded.checks.measured_on === "native_cadence" && (
                          <p className="text-xs text-slate-500 mt-3">
                            {t(`Глубина, длительность и форма — подгонка трапеции по точкам полной каденции (${fmt(folded.fit?.cadence_min, 1)} мин); в сложенной кривой глубина ${fmt(folded.checks.depth_folded_ppm, 0)} ppm — бины её размазывают.`,
                              `Depth, duration and shape come from a trapezoid fit to native-cadence points (${fmt(folded.fit?.cadence_min, 1)} min); the folded curve gives ${fmt(folded.checks.depth_folded_ppm, 0)} ppm because its bins smear the transit.`)}
                          </p>
                        )}
                      </div>

                      <div className="panel rounded-xl p-5">
                        <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                          <Info className="w-4 h-4" style={{ color: "var(--ink-3)" }} /> {t("Выводы", "Conclusions")}
                        </div>
                        <ul className="space-y-2.5">
                          {folded.notes.map((n, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                              {n.includes("не нашли") ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                              )}
                              {n}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </>
                )}
                {!folded && (
                  <p className="text-sm text-amber-300/90">
                    {t(
                      "BLS не нашёл значимого периода (короткий ряд или нет транзитов) — показана только сырая кривая. Если период известен, укажите его вручную.",
                      "BLS found no significant period (short series or no transits) — only the raw curve is shown. If the period is known, enter it manually."
                    )}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ===== Рейтинг живых кандидатов TESS ===== */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="panel rounded-xl p-6 sm:p-8"
        >
          <div className="flex items-center gap-2.5 mb-1">
            <TrendingUp className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
            <h2 className="text-xl font-semibold text-white">{t("Живые кандидаты TESS, ранжированные моделью", "Live TESS candidates ranked by the model")}</h2>
          </div>
          <p className="text-sm text-slate-500 mb-5">
            {toi ? t(`${fmt(toi.total, 0)} неподтверждённых кандидатов (PC/APC) оценены моделью — вот самые многообещающие.`, `${fmt(toi.total, 0)} unconfirmed candidates (PC/APC) scored by the model — here are the most promising.`) :
              t("Свежий список кандидатов TOI, которые астрономы ещё не проверили.", "A fresh list of TOI candidates astronomers have not yet vetted.")}
            {" "}{t("Кнопка «Кривая» скачает реальные данные и проверит сигнал.", "The “Curve” button downloads real data and checks the signal.")}
          </p>
          {toiLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : toi?.results?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-white/10">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">TOI</th>
                    <th className="py-2 pr-4 w-52">{t("Вероятность планеты", "Planet probability")}</th>
                    <th className="py-2 pr-3">{t("Период", "Period")}</th>
                    <th className="py-2 pr-3">{t("Радиус", "Radius")}</th>
                    <th className="py-2 pr-3">{t("Глубина", "Depth")}</th>
                    <th className="py-2 pr-3">T, K</th>
                    <th className="py-2 pr-3">Tmag</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {toi.results.slice(0, toiShown).map((r, i) => (
                    <tr key={r.toi} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="py-2.5 pr-3 text-slate-500 tabular">{i + 1}</td>
                      <td className="py-2.5 pr-3">
                        <a href={r.exofop} target="_blank" rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-cyan-200 font-medium inline-flex items-center gap-1">
                          TOI-{r.toi} <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
                            <div className="h-full" style={{ width: `${r.probability * 100}%`, background: probColor(r.probability), borderRadius: 2 }} />
                          </div>
                          <span className="tabular text-white text-xs w-11 text-right">{fmt(r.probability * 100, 1)}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 tabular text-slate-300">{fmt(r.period, 2)} {t("сут", "days")}</td>
                      <td className="py-2.5 pr-3 tabular text-slate-300">{r.radius ? `${fmt(r.radius, 2)} R⊕` : "—"}</td>
                      <td className="py-2.5 pr-3 tabular text-slate-300">{r.depth_ppm ? `${fmt(r.depth_ppm, 0)} ppm` : "—"}</td>
                      <td className="py-2.5 pr-3 tabular text-slate-300">{fmt(r.teq, 0)}</td>
                      <td className="py-2.5 pr-3 tabular text-slate-300">{fmt(r.tmag, 1)}</td>
                      <td className="py-2.5">
                        <Button size="sm" variant="outline" onClick={() => checkFromToi(r)}
                          className="btn-quiet h-7 px-2.5 text-xs rounded-md">
                          <Waves className="w-3 h-3 mr-1" /> {t("Кривая", "Curve")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between flex-wrap gap-3 mt-4">
                <p className="text-xs text-slate-500">
                  {t(
                    `показаны ${Math.min(toiShown, toi.results.length)} из ${toi.results.length} лучших (всего оценено ${fmt(toi.total, 0)})`,
                    `showing ${Math.min(toiShown, toi.results.length)} of ${toi.results.length} best (${fmt(toi.total, 0)} scored in total)`
                  )}
                </p>
                {toiShown < toi.results.length && (
                  <Button size="sm" variant="outline" onClick={() => setToiShown((n) => n + 10)}
                    className="btn-quiet rounded-lg"
                    data-testid="toi-more">
                    {t("Показать ещё 10", "Show 10 more")}
                  </Button>
                )}
                {toiShown > 10 && toiShown >= toi.results.length && (
                  <Button size="sm" variant="ghost" onClick={() => setToiShown(10)}
                    className="text-slate-400 hover:text-white rounded-lg">
                    {t("Свернуть до 10", "Collapse to 10")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">{t("Каталог TOI загружается на сервере — обновите страницу через минуту.", "The TOI catalog is loading on the server — refresh the page in a minute.")}</p>
          )}

          {/* ---- Охота на планеты ---- */}
          {toi?.results?.length > 0 && (
            <div className="mt-6 pt-5 border-t border-white/5">
              <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-1">
                <Crosshair className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
                {t("Охота на планеты", "Planet hunt")}
              </h3>
              <p className="text-xs text-slate-500 mb-4 max-w-3xl">
                {t(
                  "Полная проверка сигнала по реальным данным: MAST → период (BLS) → нейросеть формы → классический вэттинг. Три независимых мнения складываются в одно досье-карточку. Первая проверка цели — 1–5 минут, повторные мгновенны.",
                  "Full signal check on real data: MAST → period (BLS) → shape neural network → classical vetting. Three independent opinions combine into one dossier card. The first check of a target takes 1–5 minutes, repeats are instant."
                )}
              </p>

              {/* режим 1: автоматом по очереди TESS */}
              <div className="rounded-lg p-4 mb-3" style={{ background: "var(--void)", border: "1px solid var(--rule)" }}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm" style={{ color: "var(--ink-2)" }}>{t("Прочесать очередь TESS:", "Scan the TESS queue:")}</span>
                  <div className="flex items-center gap-1.5">
                    {[3, 5, 10].map((n) => (
                      <button key={n} onClick={() => setHuntN(n)} disabled={huntRunning}
                        aria-pressed={huntN === n}
                        className="tag tag-link"
                        style={huntN === n
                          ? { color: "var(--beam-hi)", borderColor: "var(--rule-lit)", background: "var(--beam-wash)" }
                          : undefined}>
                        {t("топ", "top")}-{n}
                      </button>
                    ))}
                  </div>
                  {!huntRunning ? (
                    <Button size="sm" onClick={runHunt}
                      className="btn-beam rounded-lg h-8 px-4"
                      data-testid="hunt-run">
                      <Telescope className="w-3.5 h-3.5 mr-1.5" /> {t("Начать охоту", "Start hunt")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => { huntStop.current = true; }}
                      className="border-slate-500/50 text-slate-300 rounded-lg h-8">
                      {t("Остановить после текущей", "Stop after current")}
                    </Button>
                  )}
                </div>
              </div>

              {/* режим 2: своя цель */}
              <div className="rounded-xl bg-slate-900/40 border border-white/5 p-4 mb-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm text-slate-300 w-full sm:w-auto">{t("Или своя цель:", "Or your own target:")}</span>
                  <Input
                    value={huntQuery}
                    onChange={(e) => setHuntQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !huntRunning && runHuntCustom()}
                    placeholder={t("TIC 307210830, Kepler-10, WASP-12…", "TIC 307210830, Kepler-10, WASP-12…")}
                    disabled={huntRunning}
                    className="flex-1 min-w-[180px] h-9 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-lg text-sm"
                    data-testid="hunt-custom-target"
                  />
                  <Input
                    value={huntPeriod}
                    onChange={(e) => setHuntPeriod(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !huntRunning && runHuntCustom()}
                    placeholder={t("период (опц.)", "period (opt.)")}
                    inputMode="decimal"
                    disabled={huntRunning}
                    className="w-full sm:w-36 h-9 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-lg text-sm"
                    data-testid="hunt-custom-period"
                  />
                  <Button size="sm" onClick={runHuntCustom} disabled={huntRunning || !huntQuery.trim()}
                    className="h-9 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg"
                    data-testid="hunt-custom-run">
                    {huntRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Crosshair className="w-3.5 h-3.5 mr-1.5" />{t("Проверить", "Check")}</>}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-600 mt-2">
                  {t("Период можно не указывать — BLS найдёт его сам. Подойдёт любая звезда с транзитом.", "The period is optional — BLS will find it itself. Any star with a transit will do.")}
                </p>
              </div>

              {huntProgress && (
                <div className="flex items-center gap-3 mb-4 panel rounded-lg px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-rose-300" />
                  <span className="text-sm text-slate-300">
                    {t("Проверяю", "Checking")} {huntProgress.i} {t("из", "of")} {huntProgress.total}: <b className="text-white">{huntProgress.label}</b> —
                    {t(" качаем кривую с MAST, это может занять пару минут…", " downloading the curve from MAST, this may take a couple of minutes…")}
                  </span>
                </div>
              )}

              {huntResults.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {huntResults.map((entry, idx) => {
                    const v = huntVerdict(entry);
                    const f = entry.lc?.folded || {};
                    const checks = f.checks || {};
                    const probs = f.nn_probs || {};
                    const m = entry.meta;
                    const shownPeriod = m.period_val ?? f.period_days;
                    return (
                      <div key={`${m.label}-${idx}`} className="panel rounded-xl p-5 border-l-2"
                        style={{ borderLeftColor: v.color }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          {m.exofop ? (
                            <a href={m.exofop} target="_blank" rel="noopener noreferrer"
                              className="font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
                              {m.label} <ExternalLink className="w-3 h-3 opacity-60" />
                            </a>
                          ) : (
                            <span className="font-semibold text-cyan-300">{m.label}</span>
                          )}
                          <span className="tag"
                            style={{ color: v.color, borderColor: `${v.color}55`, background: `${v.color}12` }}>
                            {v.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mb-3">
                          {m.radius ? `${fmt(m.radius, 2)} R⊕ · ` : ""}
                          {shownPeriod ? `P = ${fmt(shownPeriod, 4)} ${t("сут", "days")}` : ""}
                          {entry.lc?.source ? ` · ${entry.lc.source}` : ""}
                        </p>
                        {entry.error ? (
                          <p className="text-sm text-orange-300/90">{entry.error}</p>
                        ) : (
                          <>
                            <div className="space-y-2 mb-3">
                              {[[t("Табличная модель", "Tabular model"), m.tabular],
                                [t("Нейросеть формы", "Shape neural network"), probs.planet]].map(([lbl, p]) => (
                                <div key={lbl}>
                                  <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-400">{lbl}</span>
                                    <span className="tabular text-white">{p != null ? `${fmt(p * 100, 1)}%` : "—"}</span>
                                  </div>
                                  <div className="h-1.5" style={{ background: "rgba(148,163,253,.10)", borderRadius: 2 }}>
                                    <div className="h-full"
                                      style={{ width: `${(p || 0) * 100}%`, background: probColor(p || 0) }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {m.tabular == null && m.custom && (
                              <p className="text-[10.5px] text-slate-600 mb-2 -mt-1">
                                {t(
                                  "табличной оценки нет — у своей цели неизвестны параметры кандидата, судим по форме кривой и вэттингу",
                                  "no tabular estimate — a custom target has unknown candidate parameters, judged by curve shape and vetting"
                                )}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              <span className={`tag tag-word ${
                                (checks.snr ?? 0) >= 7
                                  ? "border-emerald-400/40 text-emerald-300"
                                  : "border-orange-400/40 text-orange-300"}`}>
                                SNR {fmt(checks.snr, 1)}
                              </span>
                              <span className={`tag tag-word ${
                                checks.v_shaped ? "border-red-400/40 text-red-300" : "border-emerald-400/40 text-emerald-300"}`}>
                                {checks.v_shaped ? t("V-форма ⚠", "V-shape ⚠") : t("дно плоское ✓", "flat bottom ✓")}
                              </span>
                              <span className={`tag tag-word ${
                                checks.secondary_significant ? "border-red-400/40 text-red-300" : "border-emerald-400/40 text-emerald-300"}`}>
                                {checks.secondary_significant ? t("вторичное затмение ⚠", "secondary eclipse ⚠") : t("без вторичного ✓", "no secondary ✓")}
                              </span>
                              <span className={`tag tag-word ${
                                f.odd_even?.suspicious ? "border-red-400/40 text-red-300" : "border-emerald-400/40 text-emerald-300"}`}>
                                {f.odd_even?.suspicious ? t("чёт/нечёт ⚠", "odd/even ⚠") : t("чёт/нечёт ✓", "odd/even ✓")}
                              </span>
                            </div>
                            <Button size="sm" variant="outline"
                              onClick={() => {
                                setLcTarget(m.target);
                                setLcPeriod(String(shownPeriod || ""));
                                setLcData(entry.lc);
                                lcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                              }}
                              className="btn-quiet h-7 px-2.5 text-xs rounded-md w-full">
                              <Waves className="w-3 h-3 mr-1" /> {t("Открыть кривую и графики", "Open curve and charts")}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {huntResults.length > 0 && !huntRunning && (
                <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
                  {t(
                    "Честно: «сильный кандидат» — это приоритет для проверки, а не открытие. Подтвердить планету могут только независимые наблюдения; для кандидатов TESS ссылка на карточке ведёт в ExoFOP, где видно, кто уже этим занимается.",
                    "To be honest: a “strong candidate” is a priority to check, not a discovery. Only independent observations can confirm a planet; for TESS candidates the link on the card leads to ExoFOP, where you can see who is already working on it."
                  )}
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* ===== Ручная проверка ===== */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="panel rounded-xl p-6 sm:p-8"
        >
          <div className="flex items-center gap-2.5 mb-1">
            <FlaskConical className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
            <h2 className="text-xl font-semibold text-white">{t("Проверить свои параметры", "Check your own parameters")}</h2>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            {t(
              "Введите то, что известно о кандидате (минимум 3 поля) — модель оценит вероятность и объяснит, что повлияло.",
              "Enter what is known about the candidate (at least 3 fields) — the model will estimate the probability and explain what influenced it."
            )}
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => applyPreset(p)}
                className="tag tag-link">
                {t(p.name, p.name_en)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {MANUAL_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-[11px] text-slate-500 block mb-1">{t(f.label, f.label_en)}</label>
                <Input
                  inputMode="decimal"
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={t(f.ph, f.ph_en)}
                  className="h-9 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-600 rounded-lg text-sm"
                  data-testid={`manual-${f.key}`}
                />
              </div>
            ))}
          </div>
          <Button onClick={() => runManual()} disabled={manualLoading}
            className="btn-beam h-11 px-6 rounded-lg" data-testid="manual-run">
            {manualLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("Оценить кандидата", "Evaluate candidate")}
          </Button>

          {manualResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
              <div className="panel rounded-xl p-6 text-center">
                <div className="text-5xl font-bold tabular" style={{ color: probColor(manualResult.probability) }}>
                  {fmt(manualResult.probability * 100, 1)}%
                </div>
                <div className="text-sm text-slate-400 mt-1">{t("вероятность, что это планета", "probability this is a planet")}</div>
                <div className="tag tag-word mt-3" style={{ fontSize: 13 }}
                  style={{ color: probColor(manualResult.probability), borderColor: `${probColor(manualResult.probability)}55` }}>
                  {manualResult.verdict}
                </div>
              </div>
              <div className="panel rounded-xl p-5 overflow-x-auto">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">{t("Контекст: ваши значения против медиан обучающей выборки", "Context: your values vs. training-set medians")}</div>
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-white/10">
                      <th className="py-1.5 pr-3">{t("Параметр", "Parameter")}</th>
                      <th className="py-1.5 pr-3 text-right">{t("Ваше", "Yours")}</th>
                      <th className="py-1.5 pr-3 text-right text-emerald-400">{t("Планеты", "Planets")}</th>
                      <th className="py-1.5 text-right text-red-400">{t("Ложные", "False")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualResult.explanation.map((e) => (
                      <tr key={e.label} className="border-b border-white/5 last:border-0">
                        <td className="py-1.5 pr-3 text-slate-400">{e.label}{e.unit ? `, ${e.unit}` : ""}</td>
                        <td className="py-1.5 pr-3 text-right text-white tabular">{fmt(e.value, 2)}</td>
                        <td className="py-1.5 pr-3 text-right text-emerald-300/90 tabular">{fmt(e.planet_median, 2)}</td>
                        <td className="py-1.5 text-right text-red-300/90 tabular">{fmt(e.false_positive_median, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* ===== Карточка модели ===== */}
        {info?.tabular && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="panel rounded-xl p-6 sm:p-8"
          >
            <h2 className="text-xl font-semibold text-white mb-4">{t("Как устроена модель", "How the model works")}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
                <p>
                  <b className="text-white">{t("Данные:", "Data:")}</b> {info.tabular.dataset} — {fmt(info.tabular.metrics.n_confirmed, 0)} {t("подтверждённых планет и", "confirmed planets and")} {fmt(info.tabular.metrics.n_false_positive, 0)} {t("ложноположительных. Кандидаты без вердикта в обучение не попадали.", "false positives. Candidates without a verdict were not used for training.")}
                </p>
                <p>
                  <b className="text-white">{t("Алгоритм:", "Algorithm:")}</b> {t("градиентный бустинг", "gradient boosting")} ({info.tabular.algorithm}), {t("понимает пропуски в данных — можно указывать только известные параметры.", "handles missing data — you can provide only the known parameters.")}
                </p>
                {info.tabular.lite && (
                  <p>
                    <b className="text-white">{t("Две версии:", "Two versions:")}</b> {t("полная", "full")} ({info.tabular.features?.length} {t("признака, включая диагностику пайплайна Kepler) — для метрик на KOI; переносимая", "features, including Kepler pipeline diagnostics) — for KOI metrics; a portable one")} ({info.tabular.lite.features?.length} {t("признаков,", "features,")}
                    ROC-AUC {info.tabular.lite.metrics?.roc_auc}) — {t("для кандидатов TESS и ручной формы, где диагностика Kepler недоступна.", "for TESS candidates and the manual form, where Kepler diagnostics are unavailable.")}
                  </p>
                )}
                <p>
                  <b className="text-white">{t("Честность:", "Fairness:")}</b> {t("флаги ручного вэттинга NASA исключены из признаков — иначе модель просто списала бы ответ. Оценка на отложенной выборке:", "NASA manual vetting flags are excluded from the features — otherwise the model would just copy the answer. Evaluation on the held-out set:")} ROC-AUC {info.tabular.metrics.roc_auc}, {t("точность", "accuracy")} {fmt(info.tabular.metrics.accuracy * 100, 1)}%, {t("полнота", "recall")} {fmt(info.tabular.metrics.recall * 100, 1)}%.
                </p>
                <p className="text-slate-400 text-xs border-l-2 border-amber-400/50 pl-3">
                  {t(
                    "Это инструмент приоритизации, а не «открыватель планет»: модель наследует статистику каталога Kepler и может ошибаться на нетипичных системах. Вероятность — не приговор, а подсказка, куда смотреть в первую очередь.",
                    "This is a prioritization tool, not a “planet discoverer”: the model inherits the statistics of the Kepler catalog and can be wrong on atypical systems. Probability is not a verdict but a hint of where to look first."
                  )}
                </p>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">{t("Что сильнее всего влияет (permutation importance)", "What matters most (permutation importance)")}</div>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={info.tabular.importances.slice(0, 8)} layout="vertical" margin={{ left: 30, right: 20 }}>
                      <XAxis type="number" stroke="#475569" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis type="category" dataKey="label" width={150} stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip cursor={{ fill: "rgba(148,163,184,0.06)" }}
                        contentStyle={{ background: "#131a3a", border: "1px solid #334155", borderRadius: 10, fontSize: 12 }} />
                      <Bar dataKey="importance" radius={[0, 6, 6, 0]}>
                        {info.tabular.importances.slice(0, 8).map((d, i) => (
                          <Cell key={d.feature} fill={i === 0 ? "#22d3ee" : "#6366f1"} opacity={1 - i * 0.09} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AIDetectorPage;
