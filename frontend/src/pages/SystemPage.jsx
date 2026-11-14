import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getSystem } from "@/lib/api";
import { decToDms, fmt, fmtSig, methodRu, plural, raToHms, scoreColor } from "@/lib/format";
import { useT } from "@/lib/i18n";
import SystemRuler from "@/components/SystemRuler";
import SystemOrbits from "@/components/SystemOrbits";

// Куда возвращать с кнопки «назад на небо». Берётся только из сборки, не из ссылки,
// чтобы страницу нельзя было превратить в переадресацию на чужой сайт.
const MUNINN_URL = (process.env.REACT_APP_MUNINN_URL || "https://muninn.mydevbox.xyz").replace(/\/$/, "");
const LY_PER_PC = 3.26156;

const num = (v) => (v === null || v === "" || v === undefined ? NaN : Number(v));
const inSky = (ra, dec) => Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90;

// Тот же формат, что пишет Muninn в адрес поля (public/js/hash.js)
const muninnFieldUrl = (ra, dec, name) => {
  const p = new URLSearchParams({ ra: ra.toFixed(5), dec: dec.toFixed(5), fov: "0.3", band: "all" });
  if (name) p.set("name", name);
  return `${MUNINN_URL}/#${p.toString()}`;
};

const Fact = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-4 py-2.5 border-t" style={{ borderColor: "var(--rule)" }}>
    <dt className="label-mono">{label}</dt>
    <dd className="tabular text-right text-[14px]" style={{ color: "var(--ink)" }}>{children}</dd>
  </div>
);

const SystemPage = () => {
  const t = useT();
  const [params] = useSearchParams();
  const host = params.get("host") || "";
  const ra = num(params.get("ra"));
  const dec = num(params.get("dec"));
  const fromMuninn = params.get("from") === "muninn" && inSky(ra, dec);
  const skyName = params.get("name") || "";

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
    <a href={muninnFieldUrl(ra, dec, skyName)} className="link-beam inline-flex items-center gap-1.5 text-[14px]"
       data-testid="back-to-muninn">
      <ArrowLeft className="w-4 h-4" />
      {t("Назад к полю в Muninn", "Back to the field in Muninn")}
    </a>
  );

  if (state.status !== "ready") {
    const message = {
      loading: t("Ищем звезду в каталоге…", "Looking the star up in the catalogue…"),
      empty: t("Рядом с этой точкой неба нет звёзд с подтверждёнными планетами.",
        "No star with confirmed planets near this point on the sky."),
      invalid: t("В ссылке нет ни звезды, ни координат.", "The link names neither a star nor a position."),
      error: t("Сервер не ответил. Попробуйте обновить страницу.", "The server did not answer. Try reloading the page."),
    }[state.status];
    return (
      <div className="min-h-screen pt-14 pb-16">
        <div className="max-w-6xl mx-auto px-4 pt-10">
          {back}
          <p className={`mt-6 text-[17px] ${state.status === "loading" ? "label-mono" : ""}`}
             style={{ color: "var(--ink-2)" }} role={state.status === "loading" ? "status" : "alert"}>
            {message}
          </p>
          {state.status === "empty" && (
            <p className="mt-3 text-[15px]" style={{ color: "var(--ink-3)" }}>
              {skyName && `${skyName}: `}
              {t("планеты пока известны примерно у 4 800 звёзд. Все они есть в ",
                "planets are known around roughly 4,800 stars so far. All of them are in the ")}
              <Link to="/catalog" className="link-beam">{t("каталоге", "catalogue")}</Link>.
            </p>
          )}
        </div>
      </div>
    );
  }

  const { star, planets, habitable_zone: hz, match_arcsec: matchArcsec } = state.data;
  const placed = planets.filter((p) => p.a_au > 0);
  const chartEdge = placed.length ? Math.max(...placed.map((p) => p.a_au * (1 + (p.eccentricity || 0)))) * 1.12 : 0;
  const hzBeyondChart = hz && chartEdge && hz.inner_optimistic > chartEdge;
  const n = planets.length;
  const luminosity = Number.isFinite(star.luminosity_log) ? 10 ** star.luminosity_log : null;

  return (
    <div className="min-h-screen pt-14 pb-20">
      <div className="max-w-6xl mx-auto px-4 pt-8">
        {back}

        <header className={fromMuninn ? "mt-6" : ""}>
          <div className="label-mono mb-3">NASA Exoplanet Archive · pscomppars</div>
          <h1 className="text-[36px] sm:text-[48px] font-semibold text-white leading-none"
              style={{ overflowWrap: "anywhere" }} data-testid="system-star-name">
            {star.name}
          </h1>
          <p className="mono tabular mt-4 text-[14px]" style={{ color: "var(--ink-2)" }}>
            {[star.spectral_type,
              star.temperature && `${fmt(star.temperature, 0)} K`,
              star.distance_pc && `${fmt(star.distance_pc, 1)} ${t("пк", "pc")}`,
              `${n} ${t(plural(n, "планета", "планеты", "планет"), n === 1 ? "planet" : "planets")}`,
            ].filter(Boolean).join("  ·  ")}
          </p>
          {fromMuninn && matchArcsec != null && (
            <p className="mt-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
              {skyName ? `${skyName} ${t("на небе Muninn", "on the Muninn sky")}. ` : ""}
              {t("Звезда каталога в", "The catalogue star is")} {fmt(matchArcsec, 1)}″{" "}
              {t("от выбранной точки.", "from the picked point.")}
            </p>
          )}
        </header>

        <section className="panel rounded-xl p-5 sm:p-6 mt-8" aria-labelledby="ruler-h">
          <h2 id="ruler-h" className="text-[17px] text-white mb-4">
            {t("Где планеты и где была бы Земля", "Where the planets are, and where Earth would be")}
          </h2>
          <SystemRuler star={star} planets={planets} hz={hz} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] mt-6">
          <section className="panel rounded-xl p-5 sm:p-6" aria-labelledby="orbits-h">
            <h2 id="orbits-h" className="text-[17px] text-white mb-2">{t("Вид сверху", "From above")}</h2>
            {placed.length ? (
              <>
                <SystemOrbits star={star} planets={planets} hz={hz} />
                <p className="label-mono mt-2">
                  {t("Линейный масштаб. Скорости по реальным периодам, повороты орбит условные.",
                    "Linear scale. Speeds follow the real periods; orbit orientations are arbitrary.")}
                  {hzBeyondChart && ` ${t("Зона обитаемости", "The habitable zone")} (${fmt(hz.inner_conservative, 1)}–${fmt(hz.outer_conservative, 1)} ${t("а.е.", "AU")}) ${t("дальше края схемы.", "lies beyond the edge.")}`}
                </p>
              </>
            ) : (
              <p className="text-[14px]" style={{ color: "var(--ink-3)" }}>
                {t("У планет этой системы в каталоге нет ни расстояний, ни периодов.",
                  "The catalogue has neither distances nor periods for these planets.")}
              </p>
            )}
          </section>

          <section className="panel rounded-xl p-5 sm:p-6" aria-labelledby="star-h">
            <h2 id="star-h" className="text-[17px] text-white mb-2">{t("Звезда", "Star")}</h2>
            <dl>
              <Fact label={t("Спектр", "Spectrum")}>{star.spectral_type || "—"}</Fact>
              <Fact label={t("Температура", "Temperature")}>{fmt(star.temperature, 0)} K</Fact>
              <Fact label={t("Радиус", "Radius")}>{fmt(star.radius, 2)} R☉</Fact>
              <Fact label={t("Масса", "Mass")}>{fmt(star.mass, 2)} M☉</Fact>
              <Fact label={t("Светимость", "Luminosity")}>{fmtSig(luminosity, 2)} L☉</Fact>
              <Fact label={t("Расстояние", "Distance")}>
                {star.distance_pc
                  ? `${fmt(star.distance_pc, 1)} ${t("пк", "pc")} · ${fmt(star.distance_pc * LY_PER_PC, 0)} ${t("св. лет", "ly")}`
                  : "—"}
              </Fact>
              <Fact label={t("Прямое восх.", "Right asc.")}>{raToHms(star.ra)}</Fact>
              <Fact label={t("Склонение", "Declination")}>{decToDms(star.dec)}</Fact>
              {hz && (
                <Fact label={t("Зона обит.", "Habitable zone")}>
                  {fmtSig(hz.inner_conservative, 2)}–{fmtSig(hz.outer_conservative, 2)} {t("а.е.", "AU")}
                </Fact>
              )}
              {star.star_count > 1 && <Fact label={t("Звёзд в системе", "Stars in system")}>{star.star_count}</Fact>}
            </dl>
          </section>
        </div>

        <section className="panel rounded-xl p-5 sm:p-6 mt-6" aria-labelledby="planets-h">
          <h2 id="planets-h" className="text-[17px] text-white mb-5">{t("Планеты", "Planets")}</h2>
          <div className="overflow-x-auto">
            <table className="sys-table w-full text-[14px]" data-testid="system-planets">
              <thead>
                <tr>
                  <th>{t("Планета", "Planet")}</th>
                  <th>{t("а, а.е.", "a, AU")}</th>
                  <th>{t("Период, сут", "Period, d")}</th>
                  <th>e</th>
                  <th>R⊕</th>
                  <th>M⊕</th>
                  <th>{t("Tрав, K", "Teq, K")}</th>
                  <th>{t("Обитаемость", "Habitability")}</th>
                  <th>{t("Открыта", "Found")}</th>
                </tr>
              </thead>
              <tbody>
                {planets.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <Link to={`/results?name=${encodeURIComponent(p.name)}`} className="link-beam font-medium">
                        {p.name}
                      </Link>
                    </td>
                    <td title={p.a_estimated ? t("по третьему закону Кеплера", "from Kepler's third law") : undefined}>
                      {p.a_estimated && "≈"}{fmtSig(p.a_au, 3)}
                    </td>
                    <td>{fmt(p.period_days, 2)}</td>
                    <td>{fmt(p.eccentricity, 2)}</td>
                    <td>{fmt(p.radius_earth, 2)}</td>
                    <td>{fmt(p.mass_earth, 1)}</td>
                    <td>{fmt(p.teq_k, 0)}</td>
                    <td>
                      {p.habitability != null ? (
                        <span className="inline-flex items-center gap-2 justify-end">
                          <span className="dot" style={{ background: scoreColor(p.habitability) }} />
                          {fmt(p.habitability, 0)}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ color: "var(--ink-3)" }}>
                      {p.disc_year || "—"} · {methodRu(p.method)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SystemPage;
