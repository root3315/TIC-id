import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getSystem } from "@/lib/api";
import { decToDms, fmt, fmtSig, methodRu, raToHms, scoreColor } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { describeStar, systemLede } from "@/lib/systemStory";
import { inHabitableZone, planetDotRadius } from "@/lib/systemScale";
import SystemRuler from "@/components/SystemRuler";
import SystemOrbits from "@/components/SystemOrbits";

// Куда возвращать с кнопки «назад на небо». Берётся только из сборки, не из ссылки,
// чтобы страницу нельзя было превратить в переадресацию на чужой сайт.
const MUNINN_URL = (process.env.REACT_APP_MUNINN_URL || "https://muninn.mydevbox.xyz").replace(/\/$/, "");
const LY_PER_PC = 3.26156;
const WIDE = "(min-width: 1024px)";

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

/** Число с единицей: значение крупно, единица тише. */
const Figure = ({ label, value, unit, className = "" }) => (
  <div className={`sys-figure ${className}`}>
    <dt>{label}</dt>
    <dd><span className="tabular">{value}</span>{unit && <small>{unit}</small>}</dd>
  </div>
);

// Кратность звезды словом: показываем рядом со спектром, а не в сноске
const multiplicity = (n, t) => {
  if (!(n > 1)) return null;
  if (n === 2) return t("двойная звезда", "binary star");
  if (n === 3) return t("тройная звезда", "triple star");
  return t(`${n} звезды в системе`, `${n} stars in the system`);
};

/** Подписи колонок списка планет: одна строка на весь список, а не в каждой строке. */
const PlanetHead = ({ t }) => (
  <div className="sys-planets__head" aria-hidden="true">
    <span />
    <span>{t("планета", "planet")}</span>
    <span className="sys-planets__cols">
      <span>{t("орбита", "orbit")}</span>
      <span>{t("год", "year")}</span>
      <span>{t("радиус", "radius")}</span>
      <span>{t("масса", "mass")}</span>
      <span>{t("температура", "temperature")}</span>
    </span>
    <span className="sys-planets__score-head">{t("обитаемость", "habitability")}</span>
  </div>
);

const PlanetRow = ({ p, hz, t }) => {
  const habitable = inHabitableZone(p.a_au, hz);
  const disc = Math.round(planetDotRadius(p.radius_earth) * 2.4);
  return (
    <li>
      <Link to={`/results?name=${encodeURIComponent(p.name)}`} className="sys-planet"
            aria-label={p.name} data-testid="system-planet">
        {/* тот же язык, что на сцене и линейке: диск по радиусу, обводка — зона обитаемости */}
        <span className="sys-planet__visual" aria-hidden="true">
          <span className={`sys-disc ${habitable ? "is-habitable" : ""}`} style={{ width: disc, height: disc }} />
        </span>
        <span className="sys-planet__id">
          <span className="sys-planet__name">{p.name}</span>
          <span className="sys-planet__meta">
            {[p.disc_year && t(`открыта в ${p.disc_year}`, `found ${p.disc_year}`), p.method && methodRu(p.method)]
              .filter(Boolean).join(" · ")}
            {habitable && <span className="sys-planet__zone">{t("в зоне обитаемости", "in the habitable zone")}</span>}
          </span>
        </span>
        <dl className="sys-planet__specs">
          <Figure label={t("орбита", "orbit")} value={`${p.a_estimated ? "≈" : ""}${fmtSig(p.a_au, 3)}`} unit={t("а.е.", "AU")} />
          <Figure label={t("год", "year")} value={fmt(p.period_days, p.period_days < 10 ? 2 : 0)} unit={t("сут", "d")} />
          <Figure label={t("радиус", "radius")} value={fmt(p.radius_earth, 2)} unit="R⊕" />
          <Figure className="sys-figure--extra" label={t("масса", "mass")} value={fmt(p.mass_earth, p.mass_earth < 10 ? 2 : 0)} unit="M⊕" />
          <Figure className="sys-figure--extra" label={t("температура", "temperature")} value={fmt(p.teq_k, 0)} unit="K" />
        </dl>
        <span className="sys-planet__score">
          <span className="sys-planet__score-label">{t("обитаемость", "habitability")}</span>
          {p.habitability != null
            ? <span className="tabular">{fmt(p.habitability, 0)}<small>/100</small></span>
            : "—"}
        </span>
      </Link>
    </li>
  );
};

/** Пустая сцена на месте будущей системы: искатель телескопа и орбиты без планет. */
const SearchScene = ({ wide, searching }) => {
  const rings = wide ? [64, 124, 186] : [48, 92, 136];
  const ticks = [[0, -30, 0, -21], [0, 21, 0, 30], [-30, 0, -21, 0], [21, 0, 30, 0]];
  return (
    <svg className={`sys-search ${searching ? "is-searching" : ""}`} width="100%" height={wide ? 420 : 320} aria-hidden="true">
      {/* вложенный svg ставит начало координат в центр будущей звезды */}
      <svg x={wide ? "70%" : "50%"} y="50%" overflow="visible">
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
    </svg>
  );
};

const STATUS_TEXT = {
  loading: ["Ищем в каталоге NASA звезду с планетами рядом с этой точкой неба…",
    "Looking in the NASA catalogue for a planet-hosting star near this point…"],
  empty: ["Рядом с этой точкой неба нет звёзд с подтверждёнными планетами.",
    "No star with confirmed planets near this point on the sky."],
  invalid: ["В ссылке нет ни звезды, ни координат.", "The link names neither a star nor a position."],
  error: ["Сервер не ответил. Обновите страницу через минуту.", "The server did not answer. Reload the page in a minute."],
};

const SystemStatus = ({ status, wide, back, t, name, ra, dec }) => (
  <div className="min-h-screen pt-14 pb-16">
    <section className="sys-hero max-w-6xl mx-auto px-4" aria-busy={status === "loading"}>
      {back}
      <div className="sys-stage">
        <div className="sys-stage__scene"><SearchScene wide={wide} searching={status === "loading"} /></div>
        <div className="sys-stage__text">
          <h1 className={`sys-name ${(name || "").length > 14 ? "sys-name--long" : ""}`}>{name || t("Звезда", "Star")}</h1>
          {ra != null && <p className="sys-designation">{`${raToHms(ra)}  ${decToDms(dec)}`}</p>}
          <p className="sys-lede" role={status === "loading" ? "status" : "alert"}>{t(...STATUS_TEXT[status])}</p>
          {status === "empty" && (
            <p className="sys-status-hint">
              {t("Планеты пока известны примерно у 4 800 звёзд. Все они есть в ",
                "Planets are known around roughly 4,800 stars so far. All of them are in the ")}
              <Link to="/catalog" className="link-beam">{t("каталоге", "catalogue")}</Link>.
            </p>
          )}
        </div>
      </div>
    </section>
  </div>
);

const SystemPage = () => {
  const t = useT();
  const wide = useMedia(WIDE);
  const [params] = useSearchParams();
  const host = params.get("host") || "";
  const ra = num(params.get("ra"));
  const dec = num(params.get("dec"));
  const fromMuninn = params.get("from") === "muninn" && inSky(ra, dec);
  const skyName = (params.get("name") || "").trim();

  const [state, setState] = useState({ status: "loading", data: null });

  useEffect(() => {
    if (!host && !inSky(ra, dec)) {
      setState({ status: "invalid", data: null });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading", data: null });
    getSystem(host ? { host, ...(inSky(ra, dec) && { ra, dec }) } : { ra, dec })
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e) => !cancelled && setState({
        status: e.response?.status === 404 ? "empty" : "error", data: null,
      }));
    return () => {
      cancelled = true;
    };
  }, [host, ra, dec]);

  const back = fromMuninn && (
    <a href={muninnFieldUrl(ra, dec, skyName)} className="link-beam sys-back" data-testid="back-to-muninn">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      {t("Назад к полю в Muninn", "Back to the field in Muninn")}
    </a>
  );

  if (state.status !== "ready") {
    return (
      <SystemStatus status={state.status} wide={wide} back={back} t={t}
                    name={skyName || host} ra={inSky(ra, dec) ? ra : null} dec={inSky(ra, dec) ? dec : null} />
    );
  }

  const { star, planets, habitable_zone: hz, match_arcsec: matchArcsec } = state.data;
  const displayName = skyName || star.name;
  const catalogName = skyName && skyName.toLowerCase() !== star.name.toLowerCase() ? star.name : null;
  const luminosity = Number.isFinite(star.luminosity_log) ? 10 ** star.luminosity_log : null;
  const placed = planets.filter((p) => p.a_au > 0);
  const chartEdge = placed.length ? Math.max(...placed.map((p) => p.a_au * (1 + (p.eccentricity || 0)))) * 1.12 : 0;
  const hzBeyondScene = hz && chartEdge && hz.inner_optimistic > chartEdge;

  return (
    <div className="min-h-screen pt-14 pb-20">
      <section className="sys-hero max-w-6xl mx-auto px-4" aria-labelledby="sys-name">
        {back}
        <div className="sys-stage">
          {placed.length > 0 && (
            <div className="sys-stage__scene">
              <SystemOrbits star={star} planets={planets} hz={hz}
                            height={wide ? 420 : 320} centerX={wide ? 0.7 : 0.5} />
            </div>
          )}
          <div className="sys-stage__text">
            <h1 id="sys-name" className={`sys-name ${displayName.length > 14 ? "sys-name--long" : ""}`}
                data-testid="system-star-name">{displayName}</h1>
            <p className="sys-designation">
              {[catalogName, star.spectral_type, multiplicity(star.star_count, t)].filter(Boolean).join("  ·  ") || "\u00a0"}
            </p>
            <p className="sys-lede">{systemLede(star, planets, hz, t)}</p>
            <dl className="sys-figures">
              {star.temperature && <Figure label={t("температура", "temperature")} value={fmt(star.temperature, 0)} unit="K" />}
              {star.radius && <Figure label={t("радиус", "radius")} value={fmt(star.radius, star.radius < 10 ? 2 : 1)} unit="R☉" />}
              {star.mass && <Figure label={t("масса", "mass")} value={fmt(star.mass, 2)} unit="M☉" />}
              {luminosity && <Figure label={t("светимость", "luminosity")} value={luminosity >= 10 ? fmt(luminosity, 0) : fmtSig(luminosity, 2)} unit="L☉" />}
              {/* расстояние уже сказано во фразе; цифрой — только если фразы о звезде нет */}
              {star.distance_pc && !describeStar(star, t) &&
                <Figure label={t("расстояние", "distance")} value={fmt(star.distance_pc * LY_PER_PC, 0)} unit={t("св. лет", "ly")} />}
            </dl>
          </div>
        </div>
        {placed.length > 0 && (
          <p className="sys-scene-note">
            {t("Вид сверху в настоящем масштабе, включая размер звезды. Скорости по реальным периодам, повороты орбит условные.",
              "Top view to true scale, the star's size included. Speeds follow the real periods; orbit orientations are arbitrary.")}
            {hzBeyondScene && ` ${t("Зона обитаемости лежит дальше, в", "The habitable zone lies farther out, at")} ${fmtSig(hz.inner_conservative, 2)}–${fmtSig(hz.outer_conservative, 2)} ${t("а.е.", "AU")}`}
          </p>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-4 sys-section sys-section--first" aria-labelledby="planets-h">
        <h2 id="planets-h" className="sys-h2">
          {t("Планеты", "Planets")} <span className="sys-h2__count tabular">{planets.length}</span>
        </h2>
        <PlanetHead t={t} />
        <ol className="sys-planets">
          {planets.map((p) => <PlanetRow key={p.name} p={p} hz={hz} t={t} />)}
        </ol>
      </section>

      {placed.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sys-section" aria-labelledby="ruler-h">
          <h2 id="ruler-h" className="sys-h2">{t("Где была бы Земля", "Where Earth would be")}</h2>
          <SystemRuler star={star} planets={planets} hz={hz} />
        </section>
      )}

      <footer className="max-w-6xl mx-auto px-4 sys-footnote">
        <span className="tabular">{raToHms(star.ra)}  {decToDms(star.dec)}</span>
        {fromMuninn && matchArcsec != null && (
          <span>{t("звезда каталога в", "catalogue star")} {fmt(matchArcsec, 1)}″ {t("от точки на небе Muninn", "from the Muninn sky point")}</span>
        )}
        <span>{t("данные: NASA Exoplanet Archive", "data: NASA Exoplanet Archive")}</span>
      </footer>
    </div>
  );
};

export default SystemPage;
