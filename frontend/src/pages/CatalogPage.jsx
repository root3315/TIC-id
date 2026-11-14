import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, ChevronLeft, ChevronRight, ArrowUpDown, Loader2, X, Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { getCatalog, getStats, prefetchPlanet } from "@/lib/api";
import { fmt, methodRu, planetClass, tempZone, localHistory, plural, densityOf, scoreColor } from "@/lib/format";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import PlanetVisual from "@/components/PlanetVisual";
import { useT } from "@/lib/i18n";

const SIZE_OPTIONS = [
  { v: "any", label: "Любой размер", en: "Any size" },
  { v: "earth", label: "Землеподобные (< 1.8 R⊕)", en: "Earth-like (< 1.8 R⊕)" },
  { v: "super", label: "Суперземли (1.8–2.7 R⊕)", en: "Super-Earths (1.8–2.7 R⊕)" },
  { v: "neptune", label: "Нептуноподобные (2.7–6 R⊕)", en: "Neptune-like (2.7–6 R⊕)" },
  { v: "giant", label: "Гиганты (> 6 R⊕)", en: "Giants (> 6 R⊕)" },
];

const TEMP_OPTIONS = [
  { v: "any", label: "Любая температура", en: "Any temperature" },
  { v: "cold", label: "Холодные (< 240 K)", en: "Cold (< 240 K)" },
  { v: "temperate", label: "Умеренные (240–330 K)", en: "Temperate (240–330 K)" },
  { v: "hot", label: "Горячие (> 330 K)", en: "Hot (> 330 K)" },
];

const SORT_OPTIONS = [
  { v: "hab", label: "По обитаемости", en: "By habitability" },
  { v: "esi", label: "По подобию Земле (ESI)", en: "By Earth similarity (ESI)" },
  { v: "name", label: "По имени", en: "By name" },
  { v: "year", label: "По году открытия", en: "By discovery year" },
  { v: "dist", label: "По расстоянию", en: "By distance" },
  { v: "radius", label: "По радиусу", en: "By radius" },
  { v: "mass", label: "По массе", en: "By mass" },
  { v: "temp", label: "По температуре", en: "By temperature" },
];

const PlanetCard = ({ r, onOpen, index }) => {
  const t = useT();
  const cls = planetClass(r.pl_rade, densityOf(r.pl_bmasse, r.pl_rade));
  const tz = tempZone(r.pl_eqt);
  const hoverTimer = useRef(null);
  const [fav, setFav] = useState(() => isFavorite(r.pl_name));
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => { hoverTimer.current = setTimeout(() => prefetchPlanet(r.pl_name), 300); }}
      onMouseLeave={() => clearTimeout(hoverTimer.current)}
      className="panel rounded-xl p-5 text-left hover-lift relative"
      data-testid={`catalog-card-${r.pl_name}`}
    >
      <span className="absolute top-3.5 right-3.5 flex items-center gap-2">
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            setFav(toggleFavorite({
              name: r.pl_name, radius: r.pl_rade, teq: r.pl_eqt,
              mass: r.pl_bmasse, habitability: r.habitability,
            }));
          }}
          className="leading-none p-0.5 transition-colors"
          style={{ color: fav ? "#fbbf24" : "var(--ink-4)" }}
          title={fav ? t("Убрать из избранного", "Remove from favorites") : t("В избранное", "Add to favorites")}
          data-testid={`fav-${r.pl_name}`}
        >
          <Star className="w-3.5 h-3.5" fill={fav ? "#fbbf24" : "none"} />
        </span>
        {r.habitability != null && (
          <span
            className="tag tabular"
            title={t("Приближённый индекс обитаемости", "Approximate habitability index")}
          >
            <i className="dot" style={{ background: scoreColor(r.habitability) }} />
            {fmt(r.habitability, 0)}
          </span>
        )}
      </span>
      <div className="flex items-start gap-4">
        <PlanetVisual radius={r.pl_rade} teq={r.pl_eqt} mass={r.pl_bmasse} size={58} />
        <div className="flex-1 min-w-0 pr-10">
          <div className="font-semibold text-white truncate">{r.pl_name}</div>
          <div className="text-xs truncate mt-0.5" style={{ color: "var(--ink-3)" }}>{r.hostname}</div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {cls && (
              <span className="tag tag-word"><i className="dot" style={{ background: cls.color }} />{cls.label}</span>
            )}
            {tz && (
              <span className="tag tag-word"><i className="dot" style={{ background: tz.color }} />{tz.label}</span>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5" style={{ borderTop: "1px solid var(--rule)" }}>
        {[
          [t("Радиус", "Radius"), r.pl_rade ? `${fmt(r.pl_rade, 2)} R⊕` : "—"],
          [t("Расст.", "Dist."), r.sy_dist ? `${fmt(r.sy_dist, 0)} ${t("пк", "pc")}` : "—"],
          [t("Год", "Year"), r.disc_year || "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="label-mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{k}</div>
            <div className="text-sm tabular mt-0.5" style={{ color: "var(--ink)" }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] mt-3 truncate" style={{ color: "var(--ink-4)" }}>
        {methodRu(r.discoverymethod)} · {r.disc_facility || ""}
      </div>
    </button>
  );
};

const CatalogPage = () => {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [methods, setMethods] = useState([]);
  const [filters, setFilters] = useState({
    q: "", method: "any", size_class: "any", temp_zone: "any",
    dist_max: "", year_min: "", habitable: false,
    sort: "year", order: "desc", page: 1,
  });
  const debounceRef = useRef(null);

  useEffect(() => {
    getStats().then((s) => setMethods(s.methods || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page: filters.page, per_page: 24, sort: filters.sort, order: filters.order };
    if (filters.q.trim()) params.q = filters.q.trim();
    if (filters.method !== "any") params.method = filters.method;
    if (filters.size_class !== "any") params.size_class = filters.size_class;
    if (filters.temp_zone !== "any") params.temp_zone = filters.temp_zone;
    if (filters.dist_max) params.dist_max = filters.dist_max;
    if (filters.year_min) params.year_min = filters.year_min;
    if (filters.habitable) params.min_hab = 55;
    getCatalog(params)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const setF = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const onQChange = (e) => {
    const v = e.target.value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setF({ q: v }), 250);
  };

  const openPlanet = (name) => {
    localHistory.add({ name, ts: Date.now() });
    navigate(`/results?name=${encodeURIComponent(name)}`);
  };

  const hasActiveFilters =
    filters.method !== "any" || filters.size_class !== "any" ||
    filters.temp_zone !== "any" || filters.dist_max || filters.year_min ||
    filters.q || filters.habitable;

  const selectCls = "field h-10 rounded-lg";

  return (
    <div className="min-h-screen pt-14 pb-16">
      <div className="max-w-7xl mx-auto px-4 pt-8">
        <div>
          <div className="label-mono mb-3">NASA Exoplanet Archive · pscomppars</div>
          <h1 className="text-[34px] sm:text-[40px] font-semibold text-white leading-none">
            {t("Каталог экзопланет", "Exoplanet catalog")}
          </h1>
          <p className="mt-3 mb-8 text-[15px]" style={{ color: "var(--ink-2)" }}>
            {data ? (
              <>
                <span className="tabular text-white font-medium">{fmt(data.total, 0)}</span>{" "}
                {t(`${plural(data.total, "планета", "планеты", "планет")} по текущим условиям`, `${data.total === 1 ? "planet" : "planets"} under the current conditions`)}
              </>
            ) : t("Загрузка…", "Loading…")}
          </p>
        </div>

        {/* Панель фильтров */}
        <div className="panel rounded-xl p-5 mb-8">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="label-mono">{t("Фильтры", "Filters")}</span>
            <button
              type="button"
              data-testid="filter-habitable"
              aria-pressed={filters.habitable}
              onClick={() => setF({
                habitable: !filters.habitable,
                ...(filters.habitable ? {} : { sort: "hab", order: "desc" }),
              })}
              className="tag tag-link"
              style={filters.habitable
                ? { color: "#6ee7b7", borderColor: "rgba(52,211,153,.45)", background: "rgba(52,211,153,.10)" }
                : undefined}
              title={t("Индекс обитаемости ≥ 55", "Habitability index ≥ 55")}
            >
              <i className="dot" style={{ background: filters.habitable ? "#34d399" : "var(--ink-4)" }} />
              {t("потенциально обитаемые", "potentially habitable")}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => setFilters({
                  q: "", method: "any", size_class: "any", temp_zone: "any",
                  dist_max: "", year_min: "", habitable: false,
                  sort: "year", order: "desc", page: 1,
                })}
                className="ml-auto text-xs flex items-center gap-1.5"
                style={{ color: "var(--ink-3)" }}
              >
                <X className="w-3.5 h-3.5" /> {t("Сбросить всё", "Reset all")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 z-10" style={{ color: "var(--ink-4)" }} />
              <Input
                placeholder={t("Имя планеты или звезды…", "Planet or star name…")}
                defaultValue={filters.q}
                onChange={onQChange}
                className="field pl-9 h-10 rounded-lg"
                data-testid="catalog-search"
              />
            </div>
            <Select value={filters.size_class} onValueChange={(v) => setF({ size_class: v })}>
              <SelectTrigger className={selectCls} data-testid="filter-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="panel-2 text-[color:var(--ink)]">
                {SIZE_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{t(o.label, o.en)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.temp_zone} onValueChange={(v) => setF({ temp_zone: v })}>
              <SelectTrigger className={selectCls} data-testid="filter-temp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="panel-2 text-[color:var(--ink)]">
                {TEMP_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{t(o.label, o.en)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.method} onValueChange={(v) => setF({ method: v })}>
              <SelectTrigger className={selectCls} data-testid="filter-method">
                <SelectValue placeholder={t("Метод", "Method")} />
              </SelectTrigger>
              <SelectContent className="panel-2 text-[color:var(--ink)]">
                <SelectItem value="any">{t("Любой метод", "Any method")}</SelectItem>
                {methods.map((m) => (
                  <SelectItem key={m.method} value={m.method}>
                    {methodRu(m.method)} ({fmt(m.count, 0)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder={t("Расст. ≤ пк", "Dist. ≤ pc")}
              value={filters.dist_max}
              onChange={(e) => setF({ dist_max: e.target.value })}
              className="field h-10 rounded-lg"
              data-testid="filter-dist"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <Input
              type="number"
              placeholder={t("Открыты после года…", "Discovered after year…")}
              value={filters.year_min}
              onChange={(e) => setF({ year_min: e.target.value })}
              className="field h-10 w-48 rounded-lg"
            />
            <div className="flex items-center gap-2 ml-auto">
              <ArrowUpDown className="w-4 h-4" style={{ color: "var(--ink-4)" }} />
              <Select value={filters.sort} onValueChange={(v) => setF({ sort: v })}>
                <SelectTrigger className={`${selectCls} w-44`} data-testid="filter-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="panel-2 text-[color:var(--ink)]">
                  {SORT_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{t(o.label, o.en)}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setF({ order: filters.order === "asc" ? "desc" : "asc" })}
                className="btn-quiet h-10 px-3 rounded-lg text-sm"
                title={t("Направление сортировки", "Sort direction")}
              >
                {filters.order === "asc" ? t("↑ возр.", "↑ asc.") : t("↓ убыв.", "↓ desc.")}
              </button>
            </div>
          </div>
        </div>

        {/* Сетка результатов */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton h-44 rounded-xl" />
            ))}
          </div>
        ) : data?.results?.length ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data.results.map((r, i) => (
                <PlanetCard key={r.pl_name} r={r} index={i} onOpen={() => openPlanet(r.pl_name)} />
              ))}
            </div>
            {/* Пагинация */}
            <div className="flex items-center justify-center gap-4 mt-10">
              <Button
                variant="outline"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="btn-quiet rounded-lg"
                data-testid="page-prev"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> {t("Назад", "Back")}
              </Button>
              <span className="label-mono tabular">
                {t(`Страница ${data.page} из ${fmt(data.pages, 0)}`, `Page ${data.page} of ${fmt(data.pages, 0)}`)}
              </span>
              <Button
                variant="outline"
                disabled={data.page >= data.pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="btn-quiet rounded-lg"
                data-testid="page-next"
              >
                {t("Вперёд", "Next")} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        ) : (
          <div className="panel rounded-xl p-16 text-center">
            {data === null ? (
              <div className="flex flex-col items-center gap-3" style={{ color: "var(--ink-2)" }}>
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--beam)" }} />
                {t("Не удалось загрузить каталог. Проверьте, что backend запущен.", "Failed to load the catalog. Make sure the backend is running.")}
              </div>
            ) : (
              <p className="text-lg" style={{ color: "var(--ink-2)" }}>{t("По этим фильтрам планет не найдено — попробуйте ослабить условия", "No planets found for these filters — try loosening the conditions")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CatalogPage;
