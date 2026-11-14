import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Database, Search, Copy, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Человекочитаемые подписи для самых важных колонок NASA */
const COLUMN_LABELS = {
  pl_name: "Название планеты",
  hostname: "Звезда-хозяин",
  pl_letter: "Буква планеты",
  discoverymethod: "Метод открытия",
  disc_year: "Год открытия",
  disc_facility: "Обсерватория",
  disc_telescope: "Телескоп",
  disc_instrument: "Инструмент",
  pl_orbper: "Орбитальный период, сут",
  pl_orbsmax: "Большая полуось, а.е.",
  pl_orbeccen: "Эксцентриситет",
  pl_orbincl: "Наклонение, °",
  pl_rade: "Радиус, R⊕",
  pl_radj: "Радиус, R_Jup",
  pl_bmasse: "Масса, M⊕",
  pl_bmassj: "Масса, M_Jup",
  pl_dens: "Плотность, г/см³",
  pl_eqt: "Равновесная T, K",
  pl_insol: "Инсоляция, S⊕",
  pl_trandep: "Глубина транзита, %",
  pl_trandur: "Длительность транзита, ч",
  pl_rvamp: "Амплитуда ЛС, м/с",
  st_teff: "T звезды, K",
  st_rad: "Радиус звезды, R☉",
  st_mass: "Масса звезды, M☉",
  st_met: "Металличность",
  st_logg: "log g звезды",
  st_age: "Возраст звезды, млрд лет",
  st_spectype: "Спектральный класс",
  sy_dist: "Расстояние, пк",
  sy_plx: "Параллакс, mas",
  sy_vmag: "Величина V",
  sy_kmag: "Величина K",
  sy_gaiamag: "Величина Gaia",
  ra: "RA, °",
  dec: "Dec, °",
  sy_snum: "Звёзд в системе",
  sy_pnum: "Планет в системе",
  tic_id: "TIC ID",
  gaia_id: "Gaia ID",
  rowupdate: "Обновлено NASA",
};

const cleanValue = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return fmt(v, 6);
  const s = String(v);
  const noHtml = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return noHtml || null;
};

const RawDataTab = ({ data }) => {
  const t = useT();
  const [filter, setFilter] = useState("");
  const nasa = data.nasa_data || {};

  const rows = useMemo(() => {
    const all = Object.entries(nasa)
      .map(([key, value]) => ({ key, label: COLUMN_LABELS[key], value: cleanValue(value) }))
      .filter((r) => r.value !== null);
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (r) =>
            r.key.toLowerCase().includes(q) ||
            (r.label || "").toLowerCase().includes(q) ||
            String(r.value).toLowerCase().includes(q)
        )
      : all;
    // сначала колонки с русскими подписями, затем по алфавиту
    return filtered.sort((a, b) => {
      if (!!a.label !== !!b.label) return a.label ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [nasa, filter]);

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success(t("Полный JSON скопирован в буфер", "Full JSON copied to clipboard"));
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data.name || "planet").replace(/\s+/g, "_")}_full.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel rounded-xl p-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Database className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
              {t("Композитная строка NASA Exoplanet Archive", "NASA Exoplanet Archive composite row")}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {t("Все непустые поля таблицы pscomppars — «лучшие» опубликованные значения по каждой величине", "All non-empty fields of the pscomppars table — the \"best\" published value for each quantity")}
              · {rows.length} {filter ? t("найдено", "found") : t("полей", "fields")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copyJson}
              className="border-slate-600/50 text-slate-300 hover:bg-white/5 rounded-lg">
              <Copy className="w-3.5 h-3.5 mr-1.5" /> JSON
            </Button>
            <Button size="sm" variant="outline" onClick={downloadJson}
              className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 rounded-lg">
              <Download className="w-3.5 h-3.5 mr-1.5" /> {t("Скачать", "Download")}
            </Button>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Фильтр по имени колонки, подписи или значению… (например: mag, err, орбит)", "Filter by column name, label or value… (e.g. mag, err, orbit)")}
            className="pl-9 h-10 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-lg"
            data-testid="raw-filter"
          />
        </div>

        <div className="overflow-auto rounded-xl border border-white/5" style={{ maxHeight: 560 }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#131a3a] z-10">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 font-medium">{t("Колонка", "Column")}</th>
                <th className="py-2.5 px-4 font-medium">{t("Описание", "Description")}</th>
                <th className="py-2.5 px-4 font-medium">{t("Значение", "Value")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={`border-t border-white/5 ${i % 2 ? "bg-white/[0.015]" : ""} hover:bg-cyan-500/5`}>
                  <td className="py-2 px-4 mono text-xs text-cyan-300/90 whitespace-nowrap">{r.key}</td>
                  <td className="py-2 px-4 text-slate-400 text-xs">{r.label || ""}</td>
                  <td className="py-2 px-4 text-slate-200 tabular break-all">{r.value}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">{t("Ничего не найдено", "Nothing found")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {data.simbad_data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="panel rounded-xl p-6"
        >
          <h3 className="text-base font-semibold text-white mb-3">{t("Сырой ответ SIMBAD", "Raw SIMBAD response")}</h3>
          <pre className="text-xs text-slate-300 bg-black/40 rounded-xl p-4 overflow-x-auto mono leading-relaxed">
            {JSON.stringify(data.simbad_data, null, 2)}
          </pre>
        </motion.div>
      )}
    </div>
  );
};

export default RawDataTab;
