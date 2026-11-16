import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Database, Globe, MapPin, Orbit } from "lucide-react";
import { getSystem } from "@/lib/api";
import { decToDms, fmt, fmtSig, methodRu, plural, raToHms, scoreColor, starColor } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { systemLede } from "@/lib/systemStory";
import { earthEquivalentAu, inHabitableZone } from "@/lib/systemScale";
import PlanetVisual from "@/components/PlanetVisual";
import SystemStrip from "@/components/SystemStrip";
import SystemOrbits from "@/components/SystemOrbits";

// Куда возвращать с кнопки «назад на небо». Берётся только из сборки, не из ссылки,
// чтобы страницу нельзя было превратить в переадресацию на чужой сайт.
const MUNINN_URL = (process.env.REACT_APP_MUNINN_URL || "https://muninn.mydevbox.xyz").replace(/\/$/, "");
const LY_PER_PC = 3.26156;
const VIEWS = [["scale", "В масштабе", "To scale"], ["orbits", "Вид сверху", "Top view"]];
const WIDE = "(min-width: 1024px)";
const HZ_TAG = { color: "#6ee7b7", borderColor: "rgba(52,211,153,.45)", background: "rgba(52,211,153,.10)" };

const num = (v) => (v === null || v === "" || v === undefined ? NaN : Number(v));
const inSky = (ra, dec) => Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90;

// Тот же формат, что пишет Muninn в адрес поля (public/js/hash.js)
const muninnFieldUrl = (ra, dec, name) => {
  const p = new URLSearchParams({ ra: ra.toFixed(5), dec: dec.toFixed(5), fov: "0.3", band: "all" });
  if (name) p.set("name", name);
  return `${MUNINN_URL}/#${p.toString()}`;
};

const useMedia = (query) => {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
};

// Кратность звезды словом: показываем тегом рядом со спектром
const multiplicity = (n, t) => {
  if (!(n > 1)) return null;
  if (n === 2) return t("двойная звезда", "binary star");
  if (n === 3) return t("тройная звезда", "triple star");
  return t(`${n} звезды в системе`, `${n} stars in the system`);
};

/** Почему «место Земли» не там, где серая Земля на шкале Солнечной системы. */
const earthNote = (luminosity, t) => {
  const au = earthEquivalentAu(luminosity);
  if (au == null) return null;
  const where = au >= 10 ? fmt(au, 1) : fmtSig(au, 2);
  if (luminosity > 1.5) {
    return t(
      `Эта звезда ярче Солнца в ${fmt(luminosity, luminosity < 10 ? 1 : 0)} раз, поэтому столько же света, сколько Земля получает от Солнца, здесь будет только на ${where} а.е., а не на 1 а.е., как у нас. Это и есть «место Земли».`,
      `This star is ${fmt(luminosity, luminosity < 10 ? 1 : 0)} times brighter than the Sun, so the light Earth gets from the Sun is found only at ${where} AU, not at 1 AU as at home. That is "Earth's place".`);
  }
  if (luminosity < 0.67) {
    return t(
      `Эта звезда тусклее Солнца в ${fmt(1 / luminosity, 0)} раз, поэтому «место Земли» всего в ${where} а.е. от неё — в ${fmt(1 / au, 0)} раз ближе, чем Земля к Солнцу.`,
      `This star is ${fmt(1 / luminosity, 0)} times dimmer than the Sun, so "Earth's place" is only ${where} AU from it — ${fmt(1 / au, 0)} times closer than Earth is to the Sun.`);
  }
  return t(`Звезда светит почти как Солнце, поэтому «место Земли» — около ${where} а.е., как у нас.`,
    `The star shines almost like the Sun, so "Earth's place" is about ${where} AU, as at home.`);
};

/** Звезда шаром — тот же портрет, что во вкладке «Звезда» на странице планеты. */
const StarPortrait = ({ teff, size = 136 }) => {
  const color = starColor(teff);
  return (
    <div className="rounded-full shrink-0" aria-hidden="true"
         style={{
           width: size, height: size,
           background: `radial-gradient(circle at 38% 34%, #ffffff, ${color} 42%, ${color}dd 70%)`,
           boxShadow: `0 0 44px ${color}88, 0 0 110px ${color}44`,
         }} />
  );
};

const Stat = ({ label, value }) => (
  <div>
    <div className="label-mono" style={{ color: "var(--ink-4)" }}>{label}</div>
    <div className="text-[17px] text-white tabular font-medium mt-0.5">{value}</div>
  </div>
);

const SectionHead = ({ icon: Icon, title, hint, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-4">
    <div>
      <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Icon className="w-5 h-5" style={{ color: "var(--ink-3)" }} aria-hidden="true" />
        {title}
      </h2>
      {hint && <p className="text-xs" style={{ color: "var(--ink-3)" }}>{hint}</p>}
    </div>
    {children}
  </div>
);

/** Пустая сцена на месте будущей системы: искатель телескопа и орбиты без планет. */
const SearchScene = ({ searching }) => {
  const rings = [40, 76, 112];
  const ticks = [[0, -30, 0, -21], [0, 21, 0, 30], [-30, 0, -21, 0], [21, 0, 30, 0]];
  return (
    <svg className={`sys-search ${searching ? "is-searching" : ""}`} width="240" height="240" viewBox="-120 -120 240 240"
         aria-hidden="true">
      <g className="sys-search__rings">
        {rings.map((r) => <circle key={r} r={r} />)}
      </g>
      <g className="sys-search__orbit">
        <circle r={rings[1]} className="sys-search__track" />
        <circle cy={-rings[1]} r={4} className="sys-search__planet" />
      </g>
      <g className="sys-search__reticle">
        <circle r={14} />
        {ticks.map(([x1, y1, x2, y2]) => <line key={`${x1}${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        <circle r={2.5} className="sys-search__core" />
      </g>
    </svg>
  );
};

const STATUS_TEXT = {
  loading: ["Ищем в каталоге NASA звезду с планетами рядом с этой точкой неба…",
    "Looking in the NASA catalogue for a planet-hosting star near this point…"],
  empty: ["Рядом с этой точкой неба нет звёзд с подтверждёнными планетами.",
    "No star with confirmed planets near this point on the sky."],
  notfound: ["В каталоге NASA нет звезды с планетами под таким именем.",
    "The NASA catalogue has no planet-hosting star by that name."],
  invalid: ["В ссылке нет ни звезды, ни координат.", "The link names neither a star nor a position."],
  error: ["Сервер не ответил. Обновите страницу через минуту.", "The server did not answer. Reload the page in a minute."],
};

const SystemStatus = ({ status, back, t, name, ra, dec }) => (
  <div className="min-h-screen pt-14 pb-16">
    <div className="max-w-7xl mx-auto px-4 pt-8">
      <section className="card-glow rounded-xl p-6 sm:p-10" aria-busy={status === "loading"}>
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-center">
          <div className="flex justify-center"><SearchScene searching={status === "loading"} /></div>
          <div className="text-center lg:text-left">
            {ra != null && <p className="label-mono mb-3">{`${raToHms(ra)}  ${decToDms(dec)}`}</p>}
            <h1 className="text-[32px] sm:text-[38px] font-semibold text-white mb-3 leading-none break-words">
              {name || t("Звезда", "Star")}
            </h1>
            <p className="max-w-xl leading-relaxed" style={{ color: "var(--ink-2)" }}
               role={status === "loading" ? "status" : "alert"}>{t(...STATUS_TEXT[status])}</p>
            {(status === "empty" || status === "notfound") && (
              <p className="max-w-xl mt-3 text-sm" style={{ color: "var(--ink-3)" }}>
                {t("Планеты пока известны примерно у 4 800 звёзд. Все они есть в ",
                  "Planets are known around roughly 4,800 stars so far. All of them are in the ")}
                <Link to="/catalog" className="link-beam">{t("каталоге", "catalogue")}</Link>.
              </p>
            )}
            {back && <div className="flex justify-center lg:justify-start mt-6">{back}</div>}
          </div>
        </div>
      </section>
    </div>
  </div>
);

const SystemPage = () => {
  const t = useT();
  const navigate = useNavigate();
  const wide = useMedia(WIDE);
  const [params] = useSearchParams();
  const host = params.get("host") || "";
  const ra = num(params.get("ra"));
  const dec = num(params.get("dec"));
  const fromMuninn = params.get("from") === "muninn" && inSky(ra, dec);
  const skyName = (params.get("name") || "").trim();

  const [state, setState] = useState({ status: "loading", data: null });
  const [view, setView] = useState("scale");
  const [active, setActive] = useState(null);

  useEffect(() => {
    // Muninn присылает имя звезды и позицию: сначала ищем по имени (у тесных пар,
    // как HD 41004 A и B, ближайшая по позиции звезда может оказаться соседкой)
    const byName = host || skyName;
    if (!byName && !inSky(ra, dec)) {
      setState({ status: "invalid", data: null });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading", data: null });
    getSystem(byName ? { host: byName, ...(inSky(ra, dec) && { ra, dec }) } : { ra, dec })
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e) => !cancelled && setState({
        status: e.response?.status === 404 ? (inSky(ra, dec) ? "empty" : "notfound") : "error", data: null,
      }));
    return () => {
      cancelled = true;
    };
  }, [host, skyName, ra, dec]);

  const back = fromMuninn && (
    <a href={muninnFieldUrl(ra, dec, skyName)} className="tag tag-link tag-word" data-testid="back-to-muninn">
      <ArrowLeft className="w-3 h-3" aria-hidden="true" />
      {t("Назад к полю в Muninn", "Back to the field in Muninn")}
    </a>
  );

  if (state.status !== "ready") {
    return (
      <SystemStatus status={state.status} back={back} t={t} name={skyName || host}
                    ra={inSky(ra, dec) ? ra : null} dec={inSky(ra, dec) ? dec : null} />
    );
  }

  const { star, planets, habitable_zone: hz, match_arcsec: matchArcsec } = state.data;
  const displayName = skyName || star.name;
  const catalogName = skyName && skyName.toLowerCase() !== star.name.toLowerCase() ? star.name : null;
  const luminosity = Number.isFinite(star.luminosity_log) ? 10 ** star.luminosity_log : null;
  const placed = planets.filter((p) => p.a_au > 0);
  const habitableCount = planets.filter((p) => inHabitableZone(p.a_au, hz)).length;
  const chartEdge = placed.length ? Math.max(...placed.map((p) => p.a_au * (1 + (p.eccentricity || 0)))) * 1.12 : 0;
  const hzBeyondScene = hz && chartEdge && hz.inner_optimistic > chartEdge;
  const insideMercury = chartEdge > 0 && chartEdge < 0.3;
  const multi = multiplicity(star.star_count, t);
  const open = (name) => navigate(`/results?name=${encodeURIComponent(name)}`);

  const stats = [
    star.temperature && [t("Температура", "Temperature"), `${fmt(star.temperature, 0)} K`],
    star.radius && [t("Радиус", "Radius"), `${fmt(star.radius, star.radius < 10 ? 2 : 1)} R☉`],
    star.mass && [t("Масса", "Mass"), `${fmt(star.mass, 2)} M☉`],
    luminosity && [t("Светимость", "Luminosity"), `${luminosity >= 10 ? fmt(luminosity, 0) : fmtSig(luminosity, 2)} L☉`],
    star.distance_pc && [t("До нас", "Distance"), `${fmt(star.distance_pc * LY_PER_PC, 0)} ${t("св. лет", "ly")}`],
  ].filter(Boolean);

  return (
    <div className="min-h-screen pt-14 pb-16">
      <div className="max-w-7xl mx-auto px-4 pt-8 space-y-6">
        {/* Шапка: звезда, как на вкладке «Звезда» у планеты */}
        <section className="card-glow rounded-xl p-6 sm:p-10" aria-labelledby="sys-name">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-center">
            <div className="flex justify-center lg:px-6">
              <StarPortrait teff={star.temperature} size={wide ? 150 : 112} />
            </div>
            <div className="text-center lg:text-left min-w-0">
              <div className="flex flex-wrap justify-center lg:justify-start gap-2 mb-3">
                {star.spectral_type && (
                  <span className="tag"><i className="dot" style={{ background: starColor(star.temperature) }} />{star.spectral_type}</span>
                )}
                {multi && <span className="tag tag-word">{multi}</span>}
                <span className="tag tag-word">
                  {planets.length} {t(plural(planets.length, "планета", "планеты", "планет"), planets.length === 1 ? "planet" : "planets")}
                </span>
                {habitableCount > 0 && (
                  <span className="tag tag-word" style={HZ_TAG}>
                    <i className="dot" style={{ background: "#34d399" }} />
                    {habitableCount === planets.length
                      ? t("в зоне обитаемости", "in the habitable zone")
                      : t(`${habitableCount} в зоне обитаемости`, `${habitableCount} in the habitable zone`)}
                  </span>
                )}
              </div>
              <h1 id="sys-name" className="text-[32px] sm:text-[38px] font-semibold text-white leading-none break-words"
                  data-testid="system-star-name">{displayName}</h1>
              {catalogName && <p className="label-mono mt-2">{catalogName}</p>}
              <p className="max-w-2xl leading-relaxed mt-3 mx-auto lg:mx-0" style={{ color: "var(--ink-2)" }}>
                {systemLede(star, planets, hz, t)}
              </p>
              <div className="flex flex-wrap justify-center lg:justify-start gap-x-10 gap-y-3 mt-6">
                {stats.map(([k, v]) => <Stat key={k} label={k} value={v} />)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center lg:justify-start gap-2 mt-8 pt-5" style={{ borderTop: "1px solid var(--rule)" }}>
            {back}
            <span className="tag"><MapPin className="w-3 h-3" aria-hidden="true" />{raToHms(star.ra)}  {decToDms(star.dec)}</span>
            {fromMuninn && matchArcsec != null && (
              <span className="tag tag-word">
                {t(`звезда каталога в ${fmt(matchArcsec, 1)}″ от точки Muninn`, `catalogue star ${fmt(matchArcsec, 1)}″ from the Muninn point`)}
              </span>
            )}
          </div>
        </section>

        {/* Система в масштабе */}
        {placed.length > 0 && (
          <section className="panel rounded-xl p-6" aria-labelledby="scale-h">
            <SectionHead icon={Orbit}
                         title={<span id="scale-h">{t("Система в масштабе", "The system to scale")}</span>}
                         hint={view === "scale"
                           ? t("От поверхности звезды наружу, каждое деление в 10 раз дальше — нажмите на планету, чтобы открыть её",
                             "Outward from the star's surface, each mark ten times farther — click a planet to open it")
                           : t("Вид сверху в линейном масштабе: скорости по реальным периодам, повороты орбит условные",
                             "Top view on a linear scale: speeds follow the real periods, orbit orientations are arbitrary")}>
              <div className="tabs-rule flex gap-5" role="group" aria-label={t("Как показать систему", "How to show the system")}>
                {VIEWS.map(([key, ru, en]) => (
                  <button key={key} type="button" className="tab-trigger sys-tab text-sm pb-2"
                          data-state={view === key ? "active" : "inactive"} aria-pressed={view === key}
                          onClick={() => setView(key)}>{t(ru, en)}</button>
                ))}
              </div>
            </SectionHead>
            {view === "scale"
              ? <SystemStrip star={star} planets={planets} hz={hz} active={active} onActive={setActive} />
              : <SystemOrbits star={star} planets={planets} hz={hz} height={wide ? 440 : 320} />}
            <div className="mt-5 pt-4 text-sm leading-relaxed max-w-3xl" style={{ borderTop: "1px solid var(--rule)", color: "var(--ink-2)" }}>
              {view === "scale" ? earthNote(luminosity, t) : null}
              {view === "scale" && insideMercury &&
                ` ${t("Вся система уместилась бы внутри орбиты Меркурия (0,39 а.е.).", "The whole system would fit inside Mercury's orbit (0.39 AU).")}`}
              {view === "orbits" && (hzBeyondScene
                ? t(`Зона обитаемости лежит дальше, в ${fmtSig(hz.inner_conservative, 2)}–${fmtSig(hz.outer_conservative, 2)} а.е.`,
                  `The habitable zone lies farther out, at ${fmtSig(hz.inner_conservative, 2)}–${fmtSig(hz.outer_conservative, 2)} AU.`)
                : t("Зелёные линии — границы зоны обитаемости.", "Green lines bound the habitable zone."))}
              {hz?.teff_clamped &&
                ` ${t(`Формула зоны обитаемости верна для звёзд 2600–7200 K, поэтому зона посчитана для ${fmt(hz.teff_used, 0)} K.`,
                  `The habitable-zone formula holds for 2600–7200 K stars, so the zone is computed for ${fmt(hz.teff_used, 0)} K.`)}`}
              {planets.some((p) => p.a_estimated) &&
                ` ${t("Знак ≈ — расстояние по третьему закону Кеплера.", "≈ marks a distance from Kepler's third law.")}`}
            </div>
          </section>
        )}

        {/* Планеты — та же таблица, что «Система» на странице планеты */}
        <section className="panel rounded-xl p-6" aria-labelledby="planets-h">
          <SectionHead icon={Globe}
                       title={<span id="planets-h">{t("Планеты", "Planets")} <span className="tabular" style={{ color: "var(--ink-3)" }}>{planets.length}</span></span>}
                       hint={t("Нажмите на планету, чтобы открыть её", "Click a planet to open it")} />
          {/* На телефоне — список: числа одной строкой, единицы объясняют их без шапки */}
          <ul className="sm:hidden border-t border-white/10">
            {planets.map((p) => (
              <li key={p.name} className="border-b border-white/5">
                <Link to={`/results?name=${encodeURIComponent(p.name)}`}
                      className="flex gap-3 py-3 text-slate-300 hover:bg-white/5" data-testid="system-planet-m">
                  <PlanetVisual radius={p.radius_earth} teq={p.teq_k} mass={p.mass_earth} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white truncate">{p.name}</span>
                      {p.habitability != null && (
                        <span className="tag tabular"><i className="dot" style={{ background: scoreColor(p.habitability) }} />{fmt(p.habitability, 0)}</span>
                      )}
                    </span>
                    {inHabitableZone(p.a_au, hz) && (
                      <span className="tag tag-word mt-1" style={HZ_TAG}>{t("в зоне обитаемости", "habitable zone")}</span>
                    )}
                    <span className="block text-[13px] tabular mt-1.5" style={{ color: "var(--ink-2)" }}>
                      {[
                        `${p.a_estimated ? "≈" : ""}${fmtSig(p.a_au, 3)} ${t("а.е.", "AU")}`,
                        p.period_days && `${fmt(p.period_days, p.period_days < 10 ? 2 : 0)} ${t("сут", "d")}`,
                        p.radius_earth && `${fmt(p.radius_earth, 2)} R⊕`,
                        p.mass_earth && `${fmt(p.mass_earth, p.mass_earth < 10 ? 2 : 0)} M⊕`,
                        p.teq_k && `${fmt(p.teq_k, 0)} K`,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-white/10">
                  <th className="py-2 pr-4">{t("Планета", "Planet")}</th>
                  <th className="py-2 pr-4">{t("Орбита, а.е.", "Orbit, AU")}</th>
                  <th className="py-2 pr-4">{t("Год, сут", "Year, days")}</th>
                  <th className="py-2 pr-4">{t("Радиус, R⊕", "Radius, R⊕")}</th>
                  <th className="py-2 pr-4">{t("Масса, M⊕", "Mass, M⊕")}</th>
                  <th className="py-2 pr-4">T, K</th>
                  <th className="py-2 text-right">{t("Обитаемость", "Habitability")}</th>
                </tr>
              </thead>
              <tbody>
                {planets.map((p) => {
                  const habitable = inHabitableZone(p.a_au, hz);
                  return (
                    <tr key={p.name}
                        onClick={() => open(p.name)}
                        onMouseEnter={() => setActive(p.name)} onMouseLeave={() => setActive(null)}
                        className={`border-b border-white/5 transition-colors cursor-pointer text-slate-300 hover:bg-white/5 ${active === p.name ? "bg-white/5" : ""}`}
                        data-testid="system-planet">
                      <td className="py-2.5 pr-4">
                        <Link to={`/results?name=${encodeURIComponent(p.name)}`} onClick={(e) => e.stopPropagation()}
                              onFocus={() => setActive(p.name)} onBlur={() => setActive(null)}
                              className="font-medium text-white flex items-center gap-2.5 hover:text-cyan-200">
                          <PlanetVisual radius={p.radius_earth} teq={p.teq_k} mass={p.mass_earth} size={22} />
                          {p.name}
                          {habitable && (
                            <span className="tag tag-word" style={HZ_TAG}>{t("в зоне обитаемости", "habitable zone")}</span>
                          )}
                        </Link>
                        <span className="block text-xs mt-0.5 pl-[32px]" style={{ color: "var(--ink-4)" }}>
                          {[p.disc_year, p.method && methodRu(p.method)].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 tabular">{p.a_estimated ? "≈" : ""}{fmtSig(p.a_au, 3)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.period_days, p.period_days < 10 ? 2 : 0)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.radius_earth, 2)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.mass_earth, p.mass_earth < 10 ? 2 : 0)}</td>
                      <td className="py-2.5 pr-4 tabular">{fmt(p.teq_k, 0)}</td>
                      <td className="py-2.5 text-right">
                        {p.habitability != null ? (
                          <span className="tag tabular"><i className="dot" style={{ background: scoreColor(p.habitability) }} />{fmt(p.habitability, 0)}</span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs flex items-center gap-2" style={{ color: "var(--ink-4)" }}>
          <Database className="w-3.5 h-3.5" aria-hidden="true" />
          {t("Данные: NASA Exoplanet Archive (pscomppars). Обитаемость — оценка ExoVision по размеру, температуре и орбите, из 100.",
            "Data: NASA Exoplanet Archive (pscomppars). Habitability is ExoVision's 0–100 estimate from size, temperature and orbit.")}
          {star.params_from && planets.length > 1 && ` ${t(
            `Параметры звезды — из одной записи архива (${star.params_from}).`,
            `Star parameters come from one archive record (${star.params_from}).`)}`}
        </p>
      </div>
    </div>
  );
};

export default SystemPage;
