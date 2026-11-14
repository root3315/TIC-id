import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft, Download, Scale, Info, Atom, Orbit as OrbitIcon,
  Star, Image as ImageIcon, BarChart3, BrainCircuit, Database, AlertTriangle,
  ExternalLink, Radar, FileDown, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getPlanet, getPlanetImages, getPlanetStatus } from "@/lib/api";
import { fmt, methodRu, planetClass, tempZone, categoryStyle, localHistory, densityOf } from "@/lib/format";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import { useT } from "@/lib/i18n";
import { exportPlanetDossier } from "@/lib/dossier";
import PlanetVisual from "@/components/PlanetVisual";
import HabitabilityGauge from "@/components/HabitabilityGauge";
import CompareDialog from "@/components/CompareDialog";
import LoadingScreen from "@/components/LoadingScreen";
import OverviewTab from "@/components/tabs/OverviewTab";
import PhysicalTab from "@/components/tabs/PhysicalTab";
import OrbitalTab from "@/components/tabs/OrbitalTab";
import HostStarTab from "@/components/tabs/HostStarTab";
import ImagesTab from "@/components/tabs/ImagesTab";
import GraphsTab from "@/components/tabs/GraphsTab";
import AIAnalysisTab from "@/components/tabs/AIAnalysisTab";
import RawDataTab from "@/components/tabs/RawDataTab";

// Этапы привязаны к реальному прогрессу сборки на сервере (/planet/{name}/status)
const LOADING_HINTS = [
  { ru: "Проверяем кэш и открываем каналы к архивам…", en: "Checking cache and opening channels to the archives…" },
  { ru: "NASA Exoplanet Archive: композитная строка, 700+ колонок…", en: "NASA Exoplanet Archive: composite row, 700+ columns…" },
  { ru: "SIMBAD и псевдонимы звезды…", en: "SIMBAD and star aliases…" },
  { ru: "Wikipedia и соседние планеты системы…", en: "Wikipedia and neighbouring planets in the system…" },
  { ru: "Считаем обитаемость, ESI и зону Коппарапу…", en: "Computing habitability, ESI and the Kopparapu zone…" },
];

const TAB_LIST = [
  { v: "overview", label: "Обзор", en: "Overview", icon: Info },
  { v: "physical", label: "Физика", en: "Physics", icon: Atom },
  { v: "orbital", label: "Орбита", en: "Orbit", icon: OrbitIcon },
  { v: "star", label: "Звезда", en: "Star", icon: Star },
  { v: "images", label: "Снимки", en: "Images", icon: ImageIcon },
  { v: "graphs", label: "Графики", en: "Charts", icon: BarChart3 },
  { v: "ai", label: "AI-анализ", en: "AI Analysis", icon: BrainCircuit },
  { v: "raw", label: "Все данные", en: "Raw Data", icon: Database },
];

const ResultsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nameParam = searchParams.get("name");
  const t = useT();

  const [data, setData] = useState(() => {
    const st = location.state?.data;
    return st && (!nameParam || st.name === nameParam) ? st : null;
  });
  const [loading, setLoading] = useState(!data && !!nameParam);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");
  const [imagesLoading, setImagesLoading] = useState(false);
  // Состояние AI-анализа живёт здесь, чтобы не теряться при переключении вкладок
  const [aiState, setAiState] = useState({ analysis: null, model: null, question: "" });
  const [fav, setFav] = useState(false);

  useEffect(() => {
    if (data?.name) setFav(isFavorite(data.name));
  }, [data?.name]);

  // Тяжёлые изображения подгружаются фоном после основного контента
  useEffect(() => {
    if (!data?.name || data.visualizations) return undefined;
    let cancelled = false;
    setImagesLoading(true);
    getPlanetImages(data.name)
      .then((viz) => {
        if (!cancelled) setData((prev) => (prev ? { ...prev, visualizations: viz } : prev));
      })
      .catch(() => {})
      .finally(() => !cancelled && setImagesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [data?.name, data?.visualizations]);

  useEffect(() => {
    if (data || !nameParam) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHint(0);
    // честный прогресс: спрашиваем сервер, какие источники реально уже ответили
    const statusTimer = setInterval(async () => {
      try {
        const s = await getPlanetStatus(nameParam);
        if (cancelled || !s) return;
        const idx =
          s.stage === "compute" || s.stage === "done"
            ? LOADING_HINTS.length - 1
            : s.stage === "sources"
              ? Math.min(1 + (s.sources_done?.length || 0), LOADING_HINTS.length - 1)
              : 0;
        setHint((h) => Math.max(h, idx));
      } catch {
        /* сервер занят — оставляем текущий этап */
      }
    }, 450);
    getPlanet(nameParam)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        localHistory.add({ name: d.name, ts: Date.now() });
      })
      .catch((e) => !cancelled && setError(e.response?.status === 404
        ? t("Планета не найдена в архиве подтверждённых экзопланет", "Planet not found in the confirmed exoplanet archive")
        : t("Не удалось получить данные. Проверьте, что backend запущен.", "Failed to fetch data. Make sure the backend is running.")))
      .finally(() => {
        if (!cancelled) setLoading(false);
        clearInterval(statusTimer);
      });
    return () => {
      cancelled = true;
      clearInterval(statusTimer);
    };
  }, [nameParam, data]);

  useEffect(() => {
    if (!nameParam && !location.state?.data) navigate("/");
  }, [nameParam, location.state, navigate]);

  // Сброс при переходе на другую планету (клик по планете системы)
  useEffect(() => {
    if (data && nameParam && data.name !== nameParam) {
      setData(null);
      setAiState({ analysis: null, model: null, question: "" });
      setActiveTab("overview");
    }
  }, [nameParam, data]);

  const [dossierBusy, setDossierBusy] = useState(false);
  const handleDossier = async () => {
    if (!data || dossierBusy) return;
    setDossierBusy(true);
    try {
      await exportPlanetDossier(data, t);
      toast.success(t("Досье планеты сохранено в PDF", "Planet dossier saved as PDF"));
    } catch {
      toast.error(t("Не удалось создать досье", "Failed to create dossier"));
    } finally {
      setDossierBusy(false);
    }
  };

  const handleDownloadData = () => {
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.name.replace(/\s+/g, "_")}_data.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("JSON со всеми данными сохранён", "JSON with all data saved"));
  };

  if (loading) {
    return <LoadingScreen title={nameParam} stages={LOADING_HINTS.map((h) => t(h.ru, h.en))} stage={hint} />;
  }

  if (error) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center px-4">
        <div className="glass rounded-3xl p-12 text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <p className="text-lg text-white mb-2">{error}</p>
          <p className="text-xs text-slate-500 mb-6">{t("Архив NASA иногда отвечает медленно — со второй попытки обычно получается", "The NASA archive is sometimes slow — a second attempt usually works")}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => window.location.reload()} className="btn-beam rounded-lg">
              {t("Попробовать ещё раз", "Try again")}
            </Button>
            <Link to="/">
              <Button variant="ghost" className="btn-quiet rounded-lg">
                <ArrowLeft className="w-4 h-4 mr-2" /> {t("К поиску", "To search")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hab = data.habitability_score || {};
  const phys = data.physical_params || {};
  const derived = data.derived || {};
  const disc = data.discovery_info || {};
  const cls = planetClass(phys.radius, densityOf(phys.mass, phys.radius, derived.density ?? phys.density));
  const tz = tempZone(derived.equilibrium_temp || phys.equilibrium_temp);

  return (
    <div className="min-h-screen pt-14 pb-16">
      {/* Шапка */}
      <div className="panel border-x-0 border-t-0 sticky top-14 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                data-testid="back-button"
                onClick={() => navigate("/")}
                variant="ghost"
                size="sm"
                className="shrink-0 text-[color:var(--ink-3)] hover:text-white hover:bg-white/5"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                {t("Поиск", "Search")}
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{data.name}</h1>
                <p className="mono text-[11px] truncate mt-0.5" style={{ color: "var(--ink-3)" }}>
                  {data.host_star?.name && `${t("Система", "System")} ${data.host_star.name}`}
                  {data.tic_id ? ` · ${data.tic_id}` : ""}
                </p>
              </div>
              <span className={`tag tag-word hidden md:inline-flex ${categoryStyle(hab.category)}`}>
                {hab.category_ru || "—"}
              </span>
              {disc.controversial && (
                <span className="tag tag-word hidden md:inline-flex"
                  style={{ color: "#fcd34d", borderColor: "rgba(251,191,36,.4)", background: "rgba(251,191,36,.08)" }}>
                  {t("спорная", "disputed")}
                </span>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const added = toggleFavorite({
                    name: data.name,
                    radius: phys.radius,
                    teq: derived.equilibrium_temp || phys.equilibrium_temp,
                    mass: phys.mass,
                    habitability: hab.total_score,
                  });
                  setFav(added);
                  toast.success(added ? t("Добавлена в избранное", "Added to favorites") : t("Убрана из избранного", "Removed from favorites"));
                }}
                className="btn-quiet rounded-lg"
                style={fav ? { color: "#fbbf24", borderColor: "rgba(251,191,36,.45)" } : undefined}
                title={fav ? t("Убрать из избранного", "Remove from favorites") : t("В избранное", "Add to favorites")}
                data-testid="fav-button"
              >
                <Star className={`w-4 h-4 ${fav ? "fill-amber-300" : ""}`} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/ai-detector?target=${encodeURIComponent(data.tic_id || data.host_star?.name || data.name)}&period=${data.orbital_params?.period || ""}`)}
                className="btn-quiet rounded-lg"
                title={t("Проверить кривую блеска и вердикт ML-модели", "Check the light curve and the ML model's verdict")}
                data-testid="ai-detector-button"
              >
                <Radar className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">{t("AI-детектор", "AI detector")}</span>
              </Button>
              <CompareDialog basePlanet={data}>
                <Button
                  size="sm"
                  variant="outline"
                  className="btn-quiet rounded-lg"
                  data-testid="compare-button"
                >
                  <Scale className="w-4 h-4 mr-1.5" />
                  {t("Сравнить", "Compare")}
                </Button>
              </CompareDialog>
              <Button
                data-testid="dossier-button"
                onClick={handleDossier}
                disabled={dossierBusy}
                size="sm"
                variant="outline"
                className="btn-quiet rounded-lg"
                title={t("Скачать красивое досье планеты в PDF", "Download a nice planet dossier as PDF")}
              >
                {dossierBusy
                  ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  : <FileDown className="w-4 h-4 mr-1.5" />}
                <span className="hidden sm:inline">{t("Досье", "Dossier")}</span>
              </Button>
              <Button
                data-testid="download-button"
                onClick={handleDownloadData}
                size="sm"
                variant="outline"
                className="btn-quiet rounded-lg"
              >
                <Download className="w-4 h-4 mr-1.5" />
                JSON
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 pt-8">
        <div className="card-glow rounded-xl p-6 sm:p-10 mb-8 overflow-hidden relative">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-8 items-center">
            <div className="flex justify-center">
              <div>
                <PlanetVisual
                  radius={phys.radius}
                  teq={derived.equilibrium_temp || phys.equilibrium_temp}
                  mass={phys.mass}
                  density={derived.density ?? phys.density}
                  size={190}
                  className="float"
                />
              </div>
            </div>
            <div className="text-center lg:text-left">
              <div className="flex flex-wrap justify-center lg:justify-start gap-2 mb-3">
                {cls && (
                  <span className="tag tag-word"><i className="dot" style={{ background: cls.color }} />{cls.label}</span>
                )}
                {tz && (
                  <span className="tag tag-word"><i className="dot" style={{ background: tz.color }} />{tz.label}</span>
                )}
                {derived.hz_position === "conservative" && (
                  <span className="tag tag-word"
                    style={{ color: "#6ee7b7", borderColor: "rgba(52,211,153,.45)", background: "rgba(52,211,153,.10)" }}>
                    <i className="dot" style={{ background: "#34d399" }} />
                    {t("в зоне обитаемости", "in the habitable zone")}
                  </span>
                )}
              </div>
              <h2 className="text-[32px] sm:text-[38px] font-semibold text-white mb-3 leading-none">{data.name}</h2>
              <p className="max-w-xl leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {data.wikipedia?.extract
                  ? `${data.wikipedia.extract.slice(0, 220)}${data.wikipedia.extract.length > 220 ? "…" : ""}`
                  : data.summary
                    || t(
                      `Открыта в ${disc.discovery_year || "—"} г. методом «${methodRu(disc.discovery_method)}» (${disc.discovery_facility || "—"}).`,
                      `Discovered in ${disc.discovery_year || "—"} by ${methodRu(disc.discovery_method)} (${disc.discovery_facility || "—"}).`
                    )}
              </p>
              <div className="flex flex-wrap justify-center lg:justify-start gap-x-10 gap-y-3 mt-6">
                {[
                  [t("Радиус", "Radius"), phys.radius ? `${fmt(phys.radius)} R⊕` : "—"],
                  [t("Масса", "Mass"), phys.mass ? `${fmt(phys.mass)} M⊕` : "—"],
                  [t("Год", "Year"), derived.year_length_days ? `${fmt(derived.year_length_days, 1)} ${t("сут", "days")}` : "—"],
                  [t("До нас", "Distance"), derived.distance_ly ? `${fmt(derived.distance_ly, 0)} ${t("св. лет", "ly")}` : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="label-mono" style={{ color: "var(--ink-4)" }}>{k}</div>
                    <div className="text-[17px] text-white tabular font-medium mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <HabitabilityGauge
                score={hab.total_score || 0}
                label={hab.category_ru}
                sublabel={`${t("выживаемость", "survival")} ${fmt(hab.survival_chance, 0)}%`}
              />
              {hab.esi != null && (
                <div className="label-mono text-center" style={{ color: "var(--ink-4)" }}>
                  ESI <b className="tabular text-white ml-1" style={{ fontSize: 13 }}>{hab.esi}</b>
                </div>
              )}
            </div>
          </div>

          {/* Внешние ссылки */}
          <div className="flex flex-wrap gap-2 mt-8 pt-5" style={{ borderTop: "1px solid var(--rule)" }}>
            {[
              { href: data.external_links?.nasa_archive, label: "NASA Archive" },
              { href: data.external_links?.nasa_eyes, label: "NASA Eyes 3D" },
              { href: data.external_links?.simbad, label: "SIMBAD" },
              { href: data.external_links?.wikipedia, label: "Wikipedia" },
              { href: data.external_links?.aladin, label: "Aladin Sky Atlas" },
            ].filter((l) => l.href).map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="tag tag-link"
              >
                <ExternalLink className="w-3 h-3" /> {l.label}
              </a>
            ))}
          </div>
        </div>

        {/* Вкладки */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="tabs-rule w-full justify-start overflow-x-auto flex-nowrap h-auto p-0 gap-0 mb-6 bg-transparent rounded-none">
            {TAB_LIST.map((tab) => (
              <TabsTrigger
                key={tab.v}
                data-testid={`tab-${tab.v}`}
                value={tab.v}
                className="tab-trigger px-4 py-2.5 whitespace-nowrap rounded-none bg-transparent shadow-none"
              >
                <tab.icon className="w-4 h-4 mr-2" />
                {t(tab.label, tab.en)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview"><OverviewTab data={data} /></TabsContent>
          <TabsContent value="physical"><PhysicalTab data={data} /></TabsContent>
          <TabsContent value="orbital"><OrbitalTab data={data} /></TabsContent>
          <TabsContent value="star"><HostStarTab data={data} /></TabsContent>
          <TabsContent value="images"><ImagesTab data={data} imagesLoading={imagesLoading} /></TabsContent>
          <TabsContent value="graphs"><GraphsTab data={data} /></TabsContent>
          <TabsContent value="ai">
            <AIAnalysisTab data={data} aiState={aiState} setAiState={setAiState} />
          </TabsContent>
          <TabsContent value="raw"><RawDataTab data={data} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ResultsPage;
