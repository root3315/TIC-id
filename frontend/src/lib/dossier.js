// Полноценное многостраничное «досье планеты» в PDF: собираем секции офскрин,
// снимаем каждую html2canvas и раскладываем по страницам A4 с тёмным фоном.
// Двуязычно (принимает t из useT). Описательные тексты (summary/wiki/факторы/
// рекомендации) приходят с бэкенда по-русски — в EN остаются как есть.
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { fmt, planetClass, densityOf, tempZone, scoreColor } from "./format";

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const has = (v) => v != null && v !== "" && v !== "—";

const BG = "#0a0f26";
const C = { title: "#818cf8", muted: "#8b97b8", faint: "#5b678c", text: "#e6ebf7", line: "#1b2340", panel: "#111834", chip: "#182046", chipBd: "#2a3358" };

/** data — объект планеты из /planet, t — функция перевода t(ru,en). */
export async function exportPlanetDossier(data, t) {
  const hab = data.habitability_score || {};
  const phys = data.physical_params || {};
  const orb = data.orbital_params || {};
  const der = data.derived || {};
  const star = data.host_star || {};
  const disc = data.discovery_info || {};
  const viz = data.visualizations || {};
  const links = data.external_links || {};
  const coords = star.coordinates || {};
  const mags = star.magnitudes || {};

  const teq = der.equilibrium_temp ?? phys.equilibrium_temp;
  const dens = der.density ?? phys.density;
  const cls = planetClass(phys.radius, densityOf(phys.mass, phys.radius, dens));
  const zoneObj = teq != null ? tempZone(teq) : null;
  const zone = zoneObj ? zoneObj.label : null;
  const score = hab.total_score;
  const sColor = score != null ? scoreColor(score) : C.muted;
  const catText = t(hab.category_ru || "", hab.category || "") || (cls ? cls.label : "");
  const descr = (data.wikipedia && data.wikipedia.extract) || data.summary || "";

  const hzMap = { optimistic: t("оптимистичная зона", "optimistic HZ"), conservative: t("консервативная зона", "conservative HZ"), inside: t("ближе зоны", "inside HZ"), outside: t("за пределами зоны", "outside HZ") };
  const tidalMap = { likely: t("вероятен", "likely"), unlikely: t("маловероятен", "unlikely"), locked: t("захвачена", "locked") };

  // ── строительные блоки ────────────────────────────────────────────
  const card = (inner) =>
    `<div style="width:820px;background:${BG};padding:30px 40px;color:${C.text};box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;">${inner}</div>`;

  const kicker = (title) =>
    `<div style="font-size:11px;letter-spacing:1.6px;color:${C.title};font-weight:700;text-transform:uppercase;margin-bottom:12px;border-bottom:1px solid ${C.line};padding-bottom:8px;">${esc(title)}</div>`;

  const row = (label, value) =>
    !has(value) ? "" :
    `<div style="display:flex;justify-content:space-between;gap:10px;padding:6.5px 0;border-bottom:1px solid ${C.line};">
       <span style="color:${C.muted};font-size:12.5px;">${esc(label)}</span>
       <span style="color:${C.text};font-size:12.5px;font-weight:600;text-align:right;">${esc(value)}</span>
     </div>`;

  const table = (rows) => rows.map(([l, v]) => row(l, v)).join("");

  const twoCol = (left, right) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px;align-content:start;"><div>${left}</div><div>${right}</div></div>`;

  const statCard = (value, label, color) =>
    `<div style="flex:1;padding:12px;background:${C.panel};border-radius:12px;border:1px solid ${C.line};text-align:center;">
       <div style="font-size:22px;font-weight:800;color:${color || C.text};line-height:1;">${value}</div>
       <div style="font-size:10px;color:${C.muted};margin-top:5px;">${esc(label)}</div>
     </div>`;

  const earthBar = (label, val) => {
    if (val == null) return "";
    const CLAMP = 3;
    const pct = Math.max(2, Math.min(val / CLAMP, 1) * 100);
    const earthPct = (1 / CLAMP) * 100;
    const col = val >= 2.2 ? "#f97316" : val >= 1.3 ? "#eab308" : "#34d399";
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:${C.muted};margin-bottom:3px;">
        <span>${esc(label)}</span><span style="color:${C.text};font-weight:600;">×${fmt(val, 2)}</span></div>
      <div style="position:relative;height:8px;background:#141b36;border-radius:4px;overflow:hidden;">
        <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${col};border-radius:4px;"></div>
        <div style="position:absolute;left:${earthPct}%;top:-2px;height:12px;width:2px;background:#93c5fd;"></div></div>
    </div>`;
  };

  const factorRow = (f) => {
    if (!f) return "";
    const pct = f.max ? Math.round((f.score / f.max) * 100) : 0;
    const col = pct >= 80 ? "#34d399" : pct >= 50 ? "#eab308" : "#f97316";
    return `<div style="padding:10px 0;border-bottom:1px solid ${C.line};">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:600;color:${C.text};">${esc(f.label)}</span>
        <span style="font-size:12px;color:${C.muted};">${esc(f.value || "")} · <b style="color:${col};">${f.score}/${f.max}</b></span>
      </div>
      <div style="height:6px;background:#141b36;border-radius:3px;overflow:hidden;margin:6px 0 5px;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;"></div></div>
      <div style="font-size:11.5px;color:${C.faint};">${esc(f.status || "")}</div>
    </div>`;
  };

  const chip = (c) => `<span style="display:inline-block;padding:4px 12px;background:${C.chip};border:1px solid ${C.chipBd};border-radius:20px;font-size:12px;color:#c7d2fe;margin:0 7px 7px 0;">${esc(c)}</span>`;

  const img = (src, size) => src
    ? `<img src="${src}" style="width:${size}px;height:${size}px;border-radius:16px;object-fit:cover;border:1px solid ${C.chipBd};" crossorigin="anonymous"/>`
    : `<div style="width:${size}px;height:${size}px;border-radius:16px;background:#141b36;display:flex;align-items:center;justify-content:center;color:#3a456e;font-size:12px;">${t("нет изображения", "no image")}</div>`;

  // диаграмма зоны обитаемости
  const hzDiagram = () => {
    const hz = der.habitable_zone; const a = orb.semi_major_axis;
    if (!hz || a == null) return "";
    const io = hz.inner_optimistic, ic = hz.inner_conservative, oc = hz.outer_conservative, oo = hz.outer_optimistic;
    if ([io, ic, oc, oo].some((x) => x == null)) return "";
    const max = Math.max(oo, a) * 1.14;
    const pc = (x) => Math.max(0, Math.min(1, x / max)) * 100;
    return `<div style="margin-top:6px;">
      <div style="position:relative;height:40px;">
        <div style="position:absolute;top:15px;left:0;right:0;height:10px;background:#141b36;border-radius:5px;"></div>
        <div style="position:absolute;top:15px;left:${pc(io)}%;width:${pc(oo) - pc(io)}%;height:10px;background:rgba(52,211,153,.22);border-radius:5px;"></div>
        <div style="position:absolute;top:15px;left:${pc(ic)}%;width:${pc(oc) - pc(ic)}%;height:10px;background:rgba(52,211,153,.55);border-radius:5px;"></div>
        <div style="position:absolute;top:9px;left:${pc(a)}%;margin-left:-8px;width:16px;height:16px;border-radius:50%;background:#67e8f9;border:2px solid ${BG};"></div>
        <div style="position:absolute;top:0;left:0;font-size:10px;color:#fbbf24;">★ ${esc(star.name || "")}</div>
        <div style="position:absolute;top:0;left:${pc(a)}%;margin-left:-8px;font-size:10px;color:#67e8f9;white-space:nowrap;">${fmt(a, 3)} ${t("а.е.", "AU")}</div>
      </div>
      <div style="font-size:11px;color:${C.faint};margin-top:4px;">
        ${t("Зелёная зона — консервативная зона обитаемости, светлая — оптимистичная. Голубая точка — орбита планеты.",
             "Green band — conservative habitable zone, light — optimistic. Cyan dot — the planet's orbit.")}
      </div></div>`;
  };

  // ── СЕКЦИИ ────────────────────────────────────────────────────────
  const sections = [];

  // 1. Обложка
  sections.push(card(`
    <div style="text-align:center;padding:8px 0 4px;">
      <div style="font-size:12px;letter-spacing:3px;color:${C.title};font-weight:700;">EXOVISION · ${t("ДОСЬЕ ПЛАНЕТЫ", "PLANET DOSSIER")}</div>
      <div style="font-size:46px;font-weight:800;color:#fff;margin-top:10px;line-height:1;">${esc(data.name)}</div>
      <div style="font-size:14px;color:${C.muted};margin-top:8px;">${t("Система", "System")} ${esc(star.name || "—")}${star.spectral_type ? " · " + esc(star.spectral_type) : ""}${data.tic_id ? " · " + esc(data.tic_id) : ""}</div>
      <div style="margin-top:14px;">${[cls ? cls.label : null, zone, catText].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map(chip).join("")}</div>
    </div>
    <div style="display:flex;gap:30px;align-items:center;margin-top:22px;">
      <div style="flex-shrink:0;">${img(viz.planet_portrait, 260)}
        <div style="font-size:10px;color:${C.faint};margin-top:7px;text-align:center;">${t("реконструкция по данным", "reconstruction from data")}</div>
      </div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:18px;">
          <div style="font-size:76px;font-weight:800;color:${sColor};line-height:1;">${score != null ? fmt(score, 0) : "—"}</div>
          <div><div style="font-size:11px;letter-spacing:1px;color:${C.muted};">${t("ОБИТАЕМОСТЬ · /100", "HABITABILITY · /100")}</div>
            <div style="font-size:18px;font-weight:700;color:${sColor};margin-top:4px;">${esc(catText)}</div></div>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          ${has(hab.survival_chance) ? statCard(fmt(hab.survival_chance, 0) + "%", t("выживание колонии", "colony survival"), "#e6ebf7") : ""}
          ${has(hab.esi) ? statCard(fmt(hab.esi, 3), "ESI · " + t("подобие Земле", "Earth-like"), "#67e8f9") : ""}
        </div>
      </div>
    </div>
    ${descr ? `<div style="margin-top:24px;padding:16px 18px;background:${C.panel};border-radius:12px;border:1px solid ${C.line};font-size:13.5px;line-height:1.6;color:#cbd5e1;">${esc(descr)}</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
      ${[
        [t("Радиус", "Radius"), has(phys.radius) ? fmt(phys.radius, 2) + " R⊕" : null],
        [t("Масса", "Mass"), has(phys.mass) ? fmt(phys.mass, 2) + " M⊕" : null],
        [t("Температура", "Temp."), has(teq) ? fmt(teq, 0) + " K" : null],
        [t("Период", "Period"), has(der.year_length_days) ? fmt(der.year_length_days, 0) + " " + t("сут", "d") : null],
        [t("Расстояние", "Distance"), has(der.distance_ly) ? fmt(der.distance_ly, 0) + " " + t("св. лет", "ly") : null],
      ].filter(([, v]) => has(v)).map(([l, v]) =>
        `<div style="flex:1;min-width:120px;padding:11px;background:${C.panel};border-radius:11px;border:1px solid ${C.line};text-align:center;">
           <div style="font-size:16px;font-weight:700;color:${C.text};">${esc(v)}</div>
           <div style="font-size:10px;color:${C.muted};margin-top:3px;">${esc(l)}</div></div>`).join("")}
    </div>`));

  // 2. Обитаемость (факторы)
  const facArr = hab.factors ? Object.values(hab.factors) : [];
  if (facArr.length) {
    const half = Math.ceil(facArr.length / 2);
    const recs = (hab.recommendations || []).filter(Boolean);
    const risks = (hab.risks || []).filter(Boolean);
    sections.push(card(`
      ${kicker(t("Оценка обитаемости", "Habitability assessment"))}
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">
        <div style="font-size:34px;font-weight:800;color:${sColor};">${score != null ? fmt(score, 0) : "—"}<span style="font-size:15px;color:${C.muted};font-weight:600;">/100</span></div>
        <div style="font-size:14px;font-weight:700;color:${sColor};">${esc(catText)}</div>
      </div>
      ${twoCol(facArr.slice(0, half).map(factorRow).join(""), facArr.slice(half).map(factorRow).join(""))}
      ${recs.length ? `<div style="margin-top:16px;"><div style="font-size:12px;font-weight:700;color:#34d399;margin-bottom:6px;">${t("Выводы", "Takeaways")}</div>${recs.map((x) => `<div style="font-size:12.5px;color:#cbd5e1;padding:3px 0;">✓ ${esc(x)}</div>`).join("")}</div>` : ""}
      ${risks.length ? `<div style="margin-top:12px;"><div style="font-size:12px;font-weight:700;color:#fb923c;margin-bottom:6px;">${t("Риски", "Risks")}</div>${risks.map((x) => `<div style="font-size:12.5px;color:#cbd5e1;padding:3px 0;">⚠ ${esc(x)}</div>`).join("")}</div>` : ""}
    `));
  }

  // 3. Физические параметры + сравнение с Землёй
  sections.push(card(`
    ${kicker(t("Физические параметры", "Physical parameters"))}
    ${twoCol(
      table([
        [t("Тип", "Type"), cls ? cls.label : null],
        [t("Радиус", "Radius"), has(phys.radius) ? `${fmt(phys.radius, 2)} R⊕ · ${fmt(phys.radius * 6371, 0)} ${t("км", "km")}` : null],
        [t("Масса", "Mass"), has(phys.mass) ? `${fmt(phys.mass, 2)} M⊕` : null],
        [t("Плотность", "Density"), has(dens) ? `${fmt(dens, 2)} ${t("г/см³", "g/cm³")}` : null],
        [t("Температура", "Temperature"), has(teq) ? `${fmt(teq, 0)} K · ${fmt(teq - 273.15, 0)} °C` : null],
        [t("Оценка поверхности", "Surface est."), has(der.surface_temp_estimate) ? `${fmt(der.surface_temp_estimate - 273.15, 0)} °C` : null],
      ]),
      table([
        [t("Гравитация", "Gravity"), has(der.surface_gravity_g) ? `${fmt(der.surface_gravity_g, 2)} g · ${fmt(der.surface_gravity_ms2, 1)} ${t("м/с²", "m/s²")}` : null],
        [t("2-я косм. скорость", "Escape velocity"), has(der.escape_velocity_kms) ? `${fmt(der.escape_velocity_kms, 1)} ${t("км/с", "km/s")}` : null],
        [t("Инсоляция", "Insolation"), has(der.insolation) ? `${fmt(der.insolation, 2)} S⊕` : null],
        [t("Масса (Юпитеры)", "Mass (Jup.)"), has(phys.mass_jupiter) ? `${fmt(phys.mass_jupiter, 4)} M♃` : null],
        [t("Оценка массы", "Mass source"), phys.mass_provenance],
        [t("Приливной захват", "Tidal locking"), der.tidal_locking ? (tidalMap[der.tidal_locking] || der.tidal_locking) : null],
      ])
    )}
    <div style="margin-top:16px;"><div style="font-size:12px;letter-spacing:1px;color:${C.title};font-weight:700;text-transform:uppercase;margin-bottom:10px;">${t("В сравнении с Землёй", "Compared to Earth")}</div>
      ${twoCol(
        earthBar(t("Радиус", "Radius"), phys.radius) + earthBar(t("Масса", "Mass"), phys.mass),
        earthBar(t("Гравитация", "Gravity"), der.surface_gravity_g) + earthBar(t("Инсоляция", "Insolation"), der.insolation)
      )}
      <div style="font-size:11px;color:${C.faint};margin-top:2px;">${t("синяя метка — уровень Земли (×1)", "blue mark — Earth level (×1)")}</div>
    </div>`));

  // 4. Орбита + зона обитаемости
  sections.push(card(`
    ${kicker(t("Орбита и климат", "Orbit & climate"))}
    ${twoCol(
      table([
        [t("Период обращения", "Orbital period"), has(der.year_length_days) ? `${fmt(der.year_length_days, 2)} ${t("сут", "days")}` : null],
        [t("Большая полуось", "Semi-major axis"), has(orb.semi_major_axis) ? `${fmt(orb.semi_major_axis, 3)} ${t("а.е.", "AU")}` : null],
        [t("Эксцентриситет", "Eccentricity"), has(orb.eccentricity) ? fmt(orb.eccentricity, 3) : null],
        [t("Наклонение", "Inclination"), has(orb.inclination) ? `${fmt(orb.inclination, 2)}°` : null],
        [t("Орбит. скорость", "Orbital speed"), has(der.orbital_velocity_kms) ? `${fmt(der.orbital_velocity_kms, 1)} ${t("км/с", "km/s")}` : null],
      ]),
      table([
        [t("Глубина транзита", "Transit depth"), has(orb.transit_depth) ? `${fmt(orb.transit_depth * 10000, 0)} ppm` : null],
        [t("Длит. транзита", "Transit duration"), has(orb.transit_duration) ? `${fmt(orb.transit_duration, 2)} ${t("ч", "h")}` : null],
        [t("Прицельный параметр", "Impact parameter"), has(orb.impact_parameter) ? fmt(orb.impact_parameter, 2) : null],
        [t("a / R★", "a / R★"), has(orb.a_over_rstar) ? fmt(orb.a_over_rstar, 1) : null],
        [t("Зона обитаемости", "Habitable zone"), der.hz_position ? (hzMap[der.hz_position] || der.hz_position) : null],
      ])
    )}
    <div style="margin-top:14px;"><div style="font-size:12px;letter-spacing:1px;color:${C.title};font-weight:700;text-transform:uppercase;margin-bottom:6px;">${t("Положение в зоне обитаемости", "Position in the habitable zone")}</div>
      ${hzDiagram()}</div>`));

  // 5. Звезда
  sections.push(card(`
    ${kicker(t("Родительская звезда", "Host star"))}
    <div style="display:flex;gap:26px;">
      <div style="flex-shrink:0;">${img(viz.synthetic_star, 190)}
        <div style="font-size:10px;color:${C.faint};margin-top:6px;text-align:center;">${esc(star.name || "")}${star.spectral_type ? " · " + esc(star.spectral_type) : ""}</div></div>
      <div style="flex:1;">${twoCol(
        table([
          [t("Название", "Name"), star.name],
          [t("Спектр. класс", "Spectral type"), star.spectral_type],
          [t("Температура", "Temperature"), has(star.temperature) ? `${fmt(star.temperature, 0)} K` : null],
          [t("Радиус", "Radius"), has(star.radius) ? `${fmt(star.radius, 2)} R☉` : null],
          [t("Масса", "Mass"), has(star.mass) ? `${fmt(star.mass, 2)} M☉` : null],
          [t("Светимость", "Luminosity"), has(der.star_luminosity) ? `${fmt(der.star_luminosity, 2)} L☉` : null],
        ]),
        table([
          [t("Возраст", "Age"), has(star.age) ? `${fmt(star.age, 1)} ${t("млрд лет", "Gyr")}` : null],
          [t("Металличность", "Metallicity"), has(star.metallicity) ? `${fmt(star.metallicity, 2)} [Fe/H]` : null],
          [t("log g", "log g"), has(star.gravity_log) ? fmt(star.gravity_log, 2) : null],
          [t("Расстояние", "Distance"), has(der.distance_ly) ? `${fmt(der.distance_ly, 0)} ${t("св. лет", "ly")} · ${fmt(star.distance, 1)} ${t("пк", "pc")}` : null],
          [t("Параллакс", "Parallax"), has(star.parallax_mas) ? `${fmt(star.parallax_mas, 3)} ${t("мсд", "mas")}` : null],
          [t("Собств. движение", "Proper motion"), has(star.proper_motion) ? `${fmt(star.proper_motion, 1)} ${t("мсд/год", "mas/yr")}` : null],
        ])
      )}</div>
    </div>
    <div style="margin-top:14px;"><div style="font-size:12px;letter-spacing:1px;color:${C.title};font-weight:700;text-transform:uppercase;margin-bottom:8px;">${t("Координаты и величины", "Coordinates & magnitudes")}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${[
          ["RA", coords.ra_str], ["Dec", coords.dec_str],
          [t("гал. широта", "gal. lat"), has(coords.gal_lat) ? fmt(coords.gal_lat, 2) + "°" : null],
          ["V", mags.V], ["Gaia G", mags["Gaia G"]], ["Kepler", mags.Kepler], ["TESS", mags.TESS], ["J", mags.J], ["K", mags.K],
        ].filter(([, v]) => has(v)).map(([l, v]) =>
          `<div style="padding:7px 12px;background:${C.panel};border:1px solid ${C.line};border-radius:9px;font-size:11.5px;"><span style="color:${C.muted};">${esc(l)}</span> <b style="color:${C.text};">${esc(v)}</b></div>`).join("")}
      </div></div>`));

  // 6. Открытие + источники
  sections.push(card(`
    ${kicker(t("Открытие и источники", "Discovery & sources"))}
    ${twoCol(
      table([
        [t("Год открытия", "Discovery year"), disc.discovery_year],
        [t("Метод", "Method"), t(disc.discovery_method === "Transit" ? "Транзитный" : disc.discovery_method, disc.discovery_method)],
        [t("Обсерватория", "Facility"), disc.discovery_facility],
        [t("Телескоп", "Telescope"), disc.discovery_telescope],
      ]),
      table([
        [t("Публикация", "Reference"), disc.reference_name],
        [t("Дата публикации", "Published"), disc.publication_date],
        [t("Статус", "Status"), disc.controversial === "True" || disc.controversial === true ? t("спорная (disputed)", "disputed") : t("подтверждена", "confirmed")],
        [t("TIC ID", "TIC ID"), data.tic_id],
      ])
    )}
    <div style="margin-top:16px;"><div style="font-size:12px;letter-spacing:1px;color:${C.title};font-weight:700;text-transform:uppercase;margin-bottom:8px;">${t("Ссылки", "Links")}</div>
      ${[
        ["NASA Exoplanet Archive", links.nasa_archive],
        ["NASA Eyes on Exoplanets", links.nasa_eyes],
        ["SIMBAD", links.simbad],
        ["Wikipedia", links.wikipedia || (data.wikipedia && data.wikipedia.url)],
      ].filter(([, u]) => has(u)).map(([l, u]) =>
        `<div style="font-size:11.5px;color:${C.muted};padding:2px 0;">${esc(l)}: <span style="color:#67e8f9;">${esc(u)}</span></div>`).join("")}
    </div>
    <div style="margin-top:20px;padding-top:12px;border-top:1px solid ${C.line};display:flex;justify-content:space-between;font-size:10.5px;color:${C.faint};">
      <span>${t("Источник данных: NASA Exoplanet Archive · SIMBAD · Wikipedia", "Data: NASA Exoplanet Archive · SIMBAD · Wikipedia")}</span>
      <span>ExoVision · exoplanet explorer</span>
    </div>`));

  // ── рендер офскрин и раскладка по страницам ───────────────────────
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:820px;";
  host.innerHTML = sections.join("");
  document.body.appendChild(host);

  try {
    await new Promise((r) => setTimeout(r, 220)); // дать картинкам base64 отрисоваться
    const nodes = Array.from(host.children);
    const canvases = [];
    for (const node of nodes) {
      // eslint-disable-next-line no-await-in-loop
      const cv = await html2canvas(node, { scale: 2, backgroundColor: BG, useCORS: true, logging: false });
      canvases.push(cv);
    }

    const PW = 210, MAXH = 297; // ширина A4, максимум высоты страницы (мм)
    // раскладываем секции по страницам, НЕ дробя секцию между страницами
    const items = canvases.map((cv) => ({ cv, hMM: (cv.height * PW) / cv.width }));
    const pages = [];
    let cur = [], acc = 0;
    for (const it of items) {
      if (cur.length && acc + it.hMM > MAXH + 0.5) { pages.push(cur); cur = []; acc = 0; }
      cur.push(it); acc += it.hMM;
    }
    if (cur.length) pages.push(cur);

    // высота КАЖДОЙ страницы = ровно по её содержимому → никакого пустого низа.
    // ВАЖНО: jsPDF при orientation:"portrait" переворачивает страницу, если высота < ширины
    // (короткая секция → узкая вертикальная страница, картинка обрезается). Поэтому для
    // каждой страницы выбираем ориентацию так, чтобы ширина оставалась ровно 210 мм.
    let pdf;
    pages.forEach((pg, pi) => {
      const ph = pg.reduce((s, i) => s + i.hMM, 0);
      const orient = ph >= PW ? "portrait" : "landscape";
      if (pi === 0) pdf = new jsPDF({ orientation: orient, unit: "mm", format: [PW, ph] });
      else pdf.addPage([PW, ph], orient);
      pdf.setFillColor(10, 15, 38);
      pdf.rect(0, 0, PW, ph, "F");
      let y = 0;
      for (const it of pg) {
        pdf.addImage(it.cv.toDataURL("image/jpeg", 0.95), "JPEG", 0, y, PW, it.hMM);
        y += it.hMM;
      }
    });
    pdf.save(`${(data.name || "planet").replace(/\s+/g, "_")}_dossier.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
