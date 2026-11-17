import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { suggest, comparePlanets } from "@/lib/api";
import { fmt, fmtLy, scoreColor, methodRu } from "@/lib/format";
import PlanetVisual from "@/components/PlanetVisual";
import { useT } from "@/lib/i18n";

/**
 * Строки сравнения. better:
 *  'near-1'  — лучше тот, кто ближе к земному значению 1 (радиус, гравитация…)
 *  'near-288' — ближе к 288 K; 'near-5.51' — к земной плотности
 *  'high' / 'low' — больше/меньше лучше; null — просто факт, без победителя
 */
const ROWS = [
  { label: "Радиус", en: "Radius", unit: "R⊕", unit_en: "R⊕", d: 2, better: "near", ideal: 1, get: (p) => p.physical_params?.radius },
  { label: "Масса", en: "Mass", unit: "M⊕", unit_en: "M⊕", d: 2, better: "near", ideal: 1, get: (p) => p.physical_params?.mass },
  { label: "Плотность", en: "Density", unit: "г/см³", unit_en: "g/cm³", d: 2, better: "near", ideal: 5.51, get: (p) => p.derived?.density ?? p.physical_params?.density },
  { label: "Гравитация", en: "Gravity", unit: "g", unit_en: "g", d: 2, better: "near", ideal: 1, get: (p) => p.derived?.surface_gravity_g },
  { label: "Температура", en: "Temperature", unit: "K", unit_en: "K", d: 0, better: "near", ideal: 288, get: (p) => p.derived?.equilibrium_temp ?? p.physical_params?.equilibrium_temp },
  { label: "Инсоляция", en: "Insolation", unit: "S⊕", unit_en: "S⊕", d: 2, better: "near", ideal: 1, get: (p) => p.derived?.insolation ?? p.physical_params?.insolation },
  { label: "ESI (подобие Земле)", en: "ESI (Earth similarity)", unit: "", unit_en: "", d: 3, better: "high", get: (p) => p.habitability_score?.esi },
  { label: "Шанс выживания", en: "Survival chance", unit: "%", unit_en: "%", d: 0, better: "high", get: (p) => p.habitability_score?.survival_chance },
  { label: "Год длится", en: "Year length", unit: "сут", unit_en: "days", d: 1, better: null, get: (p) => p.orbital_params?.period },
  { label: "Орбита", en: "Orbit", unit: "а.е.", unit_en: "AU", d: 3, better: null, get: (p) => p.orbital_params?.semi_major_axis },
  { label: "Эксцентриситет", en: "Eccentricity", unit: "", unit_en: "", d: 3, better: "low", get: (p) => p.orbital_params?.eccentricity },
  { label: "Расстояние до нас", en: "Distance to us", unit: "св. лет", unit_en: "ly", format: fmtLy, better: "low", get: (p) => p.derived?.distance_ly },
  { label: "Температура звезды", en: "Star temperature", unit: "K", unit_en: "K", d: 0, better: null, get: (p) => p.host_star?.temperature },
  { label: "Открыта", en: "Discovered", unit: "", unit_en: "", d: 0, better: null, get: (p) => p.discovery_info?.discovery_year },
];

const winnerOf = (row, v1, v2) => {
  if (v1 == null || v2 == null || !row.better) return 0;
  if (row.better === "high") return v1 === v2 ? 0 : v1 > v2 ? 1 : 2;
  if (row.better === "low") return v1 === v2 ? 0 : v1 < v2 ? 1 : 2;
  const d1 = Math.abs(v1 - row.ideal);
  const d2 = Math.abs(v2 - row.ideal);
  if (Math.abs(d1 - d2) < 1e-9) return 0;
  return d1 < d2 ? 1 : 2;
};

const PlanetCard = ({ planet, size, winner, onOpen }) => {
  const t = useT();
  const hab = planet.habitability_score || {};
  const color = scoreColor(hab.total_score);
  return (
    <div className={`rounded-2xl p-5 text-center relative ${winner ? "card-glow" : "glass"}`}>
      {winner && (
        <span className="tag absolute top-3 right-3" style={{ color: "#fcd34d", borderColor: "rgba(251,191,36,.4)" }}>
          <Trophy className="w-3 h-3" /> {t("пригоднее", "more suitable")}
        </span>
      )}
      <div className="flex items-end justify-center mb-3" style={{ height: 130 }}>
        <PlanetVisual
          radius={planet.physical_params?.radius}
          teq={planet.derived?.equilibrium_temp ?? planet.physical_params?.equilibrium_temp}
          mass={planet.physical_params?.mass}
          density={planet.derived?.density ?? planet.physical_params?.density}
          size={size}
        />
      </div>
      <div className="font-semibold text-white text-lg leading-tight">{planet.name}</div>
      <div className="text-xs text-slate-500 mt-0.5">
        {methodRu(planet.discovery_info?.discovery_method)}{planet.discovery_info?.discovery_year ? ` · ${planet.discovery_info.discovery_year}` : ""}
      </div>
      <div className="text-3xl font-bold tabular mt-2" style={{ color }}>
        {fmt(hab.total_score, 0)}<span className="text-sm text-slate-500 font-normal"> /100</span>
      </div>
      <div className="text-xs mt-0.5" style={{ color }}>{hab.category_ru}</div>
      <Button size="sm" variant="ghost" onClick={onOpen}
        className="mt-3 h-7 text-xs text-cyan-300 hover:text-cyan-100 hover:bg-cyan-500/10">
        {t("Открыть планету", "Open planet")} <ArrowRight className="w-3 h-3 ml-1" />
      </Button>
    </div>
  );
};

const CompareDialog = ({ basePlanet, children }) => {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const debounceRef = useRef(null);

  const onQueryChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceRef.current);
    if (v.trim().length >= 2) {
      debounceRef.current = setTimeout(async () => {
        const res = await suggest(v.trim(), 6).catch(() => null);
        setOptions(res?.suggestions?.filter((s) => s.pl_name !== basePlanet.name) || []);
      }, 200);
    } else {
      setOptions([]);
    }
  };

  const runCompare = async (otherName) => {
    setLoading(true);
    setOptions([]);
    setQuery(otherName);
    try {
      const res = await comparePlanets(basePlanet.name, otherName);
      setResult(res);
    } catch {
      toast.error(t("Не удалось сравнить: планета не найдена или backend недоступен", "Failed to compare: planet not found or backend unavailable"));
    } finally {
      setLoading(false);
    }
  };

  const openPlanet = (name) => {
    setOpen(false);
    navigate(`/results?name=${encodeURIComponent(name)}`);
  };

  const p1 = result?.planet1;
  const p2 = result?.planet2;
  const winner = result?.comparison?.better_habitability;

  // честный масштаб шаров: размер пропорционален радиусу
  const r1 = p1?.physical_params?.radius ?? 1;
  const r2 = p2?.physical_params?.radius ?? 1;
  const maxR = Math.max(r1, r2);
  const sizeOf = (r) => Math.max(26, Math.round((r / maxR) * 120));

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResult(null); setQuery(""); setOptions([]); } }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="glass-strong border-indigo-300/20 text-white max-w-3xl max-h-[86vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("Сравнение планет", "Planet comparison")}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {basePlanet.name} {t("против любой из", "vs any of the")} {""}
            <span className="text-slate-300">{t("6 000+ планет каталога NASA", "6,000+ planets in the NASA catalog")}</span> {t("— начните вводить название", "— start typing a name")}
          </DialogDescription>
        </DialogHeader>

        {/* Поиск соперника: список в потоке — ничего не обрезается */}
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={query}
              onChange={onQueryChange}
              placeholder={t("Например: Kepler-452 b, TRAPPIST-1 e, WASP-12 b…", "e.g. Kepler-452 b, TRAPPIST-1 e, WASP-12 b…")}
              className="pl-9 h-11 bg-slate-900/70 border-slate-600/40 text-white placeholder:text-slate-500 rounded-xl"
              data-testid="compare-input"
            />
          </div>
          {options.length > 0 && (
            <div className="mt-2 glass rounded-xl overflow-hidden divide-y divide-white/5">
              {options.map((s) => (
                <button
                  key={s.pl_name}
                  type="button"
                  onClick={() => runCompare(s.pl_name)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-cyan-500/10"
                >
                  <PlanetVisual radius={s.pl_rade} teq={s.pl_eqt} mass={s.pl_bmasse} size={26} />
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{s.pl_name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{s.hostname} · {s.disc_year || "—"}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 ml-auto shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && (
          <div className="py-12 text-center">
            <Loader2 className="w-9 h-9 animate-spin mx-auto mb-3" style={{ color: "var(--ink-3)" }} />
            <p className="text-sm text-slate-400">{t("Собираем данные обеих планет…", "Gathering data for both planets…")}</p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-5 mt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PlanetCard planet={p1} size={sizeOf(r1)} winner={winner === p1.name} onOpen={() => openPlanet(p1.name)} />
              <PlanetCard planet={p2} size={sizeOf(r2)} winner={winner === p2.name} onOpen={() => openPlanet(p2.name)} />
            </div>
            <p className="text-center text-xs text-slate-500 -mt-2">{t("шары показаны в одном масштабе — по реальному соотношению радиусов", "spheres are shown at the same scale — by their real radius ratio")}</p>

            {/* Таблица параметров: зелёная точка — чьё значение ближе к земному / выгоднее */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="text-left py-2.5 px-4 text-xs uppercase tracking-wider text-slate-500 font-medium">{t("Параметр", "Parameter")}</th>
                    <th className="text-right py-2.5 px-4 text-xs text-cyan-300 font-semibold">{p1.name}</th>
                    <th className="text-right py-2.5 px-4 text-xs text-indigo-300 font-semibold">{p2.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const v1 = row.get(p1);
                    const v2 = row.get(p2);
                    if (v1 == null && v2 == null) return null;
                    const w = winnerOf(row, v1, v2);
                    const dot = <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />;
                    return (
                      <tr key={row.label} className="border-t border-white/5">
                        <td className="py-2 px-4 text-slate-400">{t(row.label, row.en)}{row.unit ? `, ${t(row.unit, row.unit_en)}` : ""}</td>
                        <td className={`py-2 px-4 text-right tabular ${w === 1 ? "text-emerald-200 font-medium" : "text-white"}`}>
                          {w === 1 && dot}{row.format ? row.format(v1) : fmt(v1, row.d)}
                        </td>
                        <td className={`py-2 px-4 text-right tabular ${w === 2 ? "text-emerald-200 font-medium" : "text-white"}`}>
                          {w === 2 && dot}{row.format ? row.format(v2) : fmt(v2, row.d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
              {t("— значение выгоднее для жизни (ближе к земному); строки без точек — просто факты", "— value more favorable for life (closer to Earth's); rows without dots are just facts")}
            </p>

            {/* Факторы бок о бок */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[p1, p2].map((p) => (
                <div key={p.name} className="glass rounded-xl p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-300 mb-1 truncate">{p.name}</div>
                  {Object.values(p.habitability_score?.factors || {}).map((f) => {
                    const pct = f.max ? (f.score / f.max) * 100 : 0;
                    return (
                      <div key={f.label}>
                        <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                          <span>{f.label}</span>
                          <span className="tabular">{f.score}/{f.max}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-700/50">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: pct > 66 ? "#22c55e" : pct > 40 ? "#eab308" : "#ef4444",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CompareDialog;
