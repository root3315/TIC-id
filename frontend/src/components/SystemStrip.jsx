import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmt, fmtSig, starColor } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  AU_PER_SOLAR_RADIUS, SOLAR_REFERENCE, axisDomain, decadeTicks, earthEquivalentAu,
  inHabitableZone, labelLanes, logX, planetDotRadius, planetLetter, stackLabels,
} from "@/lib/systemScale";

const VERTICAL_BELOW = 640;  // уже этого ось встаёт вертикально: листаешь — уходишь от звезды
const CHAR_PX = 6.6;         // ширина знака подписи (Plex Mono 11px) для проверки наложений
const PAD = 14;

const clampEcc = (e) => (Number.isFinite(e) ? Math.min(Math.max(e, 0), 0.95) : 0);
const textSpan = (x, text, anchor) => {
  const w = text.length * CHAR_PX;
  if (anchor === "end") return [x - w, x];
  if (anchor === "middle") return [x - w / 2, x + w / 2];
  return [x, x + w];
};

/** Орбита и год планеты одной строкой: единицы сами объясняют числа. */
const planetData = (p, t) => `${p.a_estimated ? "≈" : ""}${fmtSig(p.a_au, 3)} ${t("а.е.", "AU")}`
  + (p.period_days ? ` · ${fmt(p.period_days, p.period_days < 10 ? 1 : 0)} ${t("сут", "d")}` : "");

/** Общая часть обеих ориентаций: что и где лежит на оси в а.е. */
const useSystemGeometry = (star, planets, hz) => {
  const luminosity = Number.isFinite(star.luminosity_log) ? 10 ** star.luminosity_log : null;
  const earthAu = earthEquivalentAu(luminosity);
  const starAu = star.radius ? star.radius * AU_PER_SOLAR_RADIUS : null;
  const placed = planets.filter((p) => p.a_au > 0).sort((a, b) => a.a_au - b.a_au);
  const domain = axisDomain({ planets: placed, hz, extra: [earthAu, starAu] });
  const solar = SOLAR_REFERENCE.filter((s) => s.a >= domain[0] && s.a <= domain[1]);
  return { earthAu, starAu, placed, domain, solar, ticks: decadeTicks(domain), color: starColor(star.temperature) };
};

/** Тот же цвет темнее: потемнение диска к краю, как у настоящей звезды. */
const shade = (hex, k) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k)
  .toString(16).padStart(2, "0")).join("")}`;

/** Поверхность звезды — край диска в настоящем размере, с потемнением к краю. */
const StarDisc = ({ id, cx, cy, r, color }) => (
  <g>
    <defs>
      <radialGradient id={`${id}-limb`} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
        <stop offset="0.55" stopColor={color} />
        <stop offset="0.93" stopColor={shade(color, 0.86)} />
        <stop offset="1" stopColor={shade(color, 0.7)} />
      </radialGradient>
      <radialGradient id={`${id}-corona`} cx={cx} cy={cy} r={r + 14} gradientUnits="userSpaceOnUse">
        <stop offset={r / (r + 14)} stopColor={color} stopOpacity="0.22" />
        <stop offset="1" stopColor={color} stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx={cx} cy={cy} r={r + 14} fill={`url(#${id}-corona)`} />
    <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-limb)`} />
  </g>
);

/** Наконечник стрелки «Земля у Солнца → место Земли». */
const Arrow = ({ id }) => (
  <marker id={`${id}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L8,4 L0,8 z" className="ss-arrow-head" />
  </marker>
);

/** Во сколько раз дальше (или ближе) Земле пришлось бы встать у этой звезды. */
const earthShift = (earthAu, t) => (earthAu >= 1
  ? t(`в ${fmt(earthAu, 1)} раза дальше`, `${fmt(earthAu, 1)}× farther`)
  : t(`в ${fmt(1 / earthAu, 0)} раз ближе`, `${fmt(1 / earthAu, 0)}× closer`));

/** Планета на оси: кликается, подсвечивается вместе со строкой списка. */
const PlanetMark = ({ p, x, y, r, active, onActive, onOpen, label, children }) => {
  const t = useT();
  return (
    <g className={`ss-planet ${active ? "is-active" : ""}`} tabIndex={0} role="link"
       aria-label={`${p.name}, ${fmt(p.a_au, 3)} ${t("а.е.", "AU")}`}
       onClick={onOpen} onMouseEnter={() => onActive(p.name)} onMouseLeave={() => onActive(null)}
       onFocus={() => onActive(p.name)} onBlur={() => onActive(null)}
       onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onOpen())}>
      <title>{label}</title>
      {children}
      <circle cx={x} cy={y} r={r + 8} fill="transparent" />
      <circle className="ss-dot" cx={x} cy={y} r={r} />
    </g>
  );
};

const Horizontal = ({ geo, star, hz, width, active, onActive, open, id }) => {
  const t = useT();
  const { earthAu, starAu, placed, domain, solar, ticks, color } = geo;
  const top = 48;
  const axisY = 194;
  const cy = 126;
  const solarY = axisY + 54;
  const height = solar.length ? solarY + 26 : axisY + 34;
  const x = (au) => PAD + logX(domain, width - PAD * 2)(au);
  const anchorAt = (xc) => (xc > width - 60 ? "end" : xc < 60 ? "start" : "middle");

  const xs = placed.map((p) => x(p.a_au));
  const lanes = labelLanes(xs, 30);
  // Под точкой — орбита и год, если строка не налезает на соседей; иначе только при наведении
  const dataW = placed.map((p) => planetData(p, t).length * CHAR_PX);
  const dataFits = xs.map((xi, i) => [i - 1, i + 1].every((j) => j < 0 || j >= xs.length
    || Math.abs(xs[j] - xi) > (dataW[i] + dataW[j]) / 2 + 14)
    && xi - dataW[i] / 2 > PAD && xi + dataW[i] / 2 < width - PAD);
  const starX = starAu ? x(starAu) : null;
  // радиус дуги подобран так, чтобы край читался диском, а не плашкой
  const big = Math.max(starX ?? 0, 260);
  const starLabel = `${t("поверхность звезды", "star's surface")} · ${fmtSig(starAu, 2)} ${t("а.е.", "AU")}`;
  const starLabelInside = starX != null && starX - PAD > starLabel.length * CHAR_PX + 24;

  // Стрелка от настоящей Земли (1 а.е. у Солнца) к месту Земли у этой звезды
  const earthGhost = earthAu != null && solar.some((s) => s.en === "Earth") && Math.abs(x(earthAu) - x(1)) > 30;

  const taken = [];
  const solarMarks = solar.map((s) => ({ ...s, x: x(s.a), label: t(s.ru, s.en) }));
  solarMarks.forEach((s) => {
    s.anchor = anchorAt(s.x);
    const [a, b] = textSpan(s.x, s.label, s.anchor);
    s.show = taken.every(([c, d]) => b + 10 < c || a - 10 > d);
    if (s.show) taken.push([a, b]);
  });

  return (
    <svg width={width} height={height} role="group" className="ss"
         aria-label={t("Система в масштабе: расстояния от звезды в астрономических единицах, логарифмическая шкала",
           "The system to scale: distances from the star in astronomical units, logarithmic scale")}>
      <defs>
        <clipPath id={`${id}-band`}><rect x={0} y={0} width={width} height={axisY} /></clipPath>
        <Arrow id={id} />
      </defs>

      {hz && (
        <g>
          <rect className="ss-hz" x={x(hz.inner_optimistic)} y={top} height={axisY - top}
                width={Math.max(x(hz.outer_optimistic) - x(hz.inner_optimistic), 1)} fillOpacity={0.07} />
          <rect className="ss-hz" x={x(hz.inner_conservative)} y={top} height={axisY - top}
                width={Math.max(x(hz.outer_conservative) - x(hz.inner_conservative), 1)} fillOpacity={0.13} />
          {x(hz.outer_conservative) - x(hz.inner_conservative) > 128 && (
            <text className="ss-hz-label" x={x(hz.inner_conservative) + 10} y={top + 18}>
              {t("зона обитаемости", "habitable zone")}
            </text>
          )}
        </g>
      )}

      {starX != null && (
        <g clipPath={`url(#${id}-band)`}>
          <StarDisc id={id} cx={starX - big} cy={cy} r={big} color={color} />
        </g>
      )}
      {starX != null && (
        <text className={starLabelInside ? "ss-star-label is-inside" : "ss-star-label"}
              x={starLabelInside ? starX - 14 : starX + 10} y={axisY - 12}
              textAnchor={starLabelInside ? "end" : "start"}>
          {starLabel}
        </text>
      )}

      {earthAu != null && (
        <g className="ss-earth">
          <line x1={x(earthAu)} x2={x(earthAu)} y1={top - 6} y2={earthGhost ? solarY - 6 : axisY} />
          <text x={x(earthAu)} y={top - 24} textAnchor={anchorAt(x(earthAu))}>{t("место Земли", "Earth's place")}</text>
          <text className="ss-earth-sub" x={x(earthAu)} y={top - 10} textAnchor={anchorAt(x(earthAu))}>
            {t("столько же света, как у Земли", "as much light as Earth gets")}
          </text>
        </g>
      )}

      <line className="ss-axis" x1={PAD} x2={width - PAD} y1={axisY} y2={axisY} />
      {ticks.map((au, i) => (
        <g key={au} className="ss-tick">
          <line x1={x(au)} x2={x(au)} y1={axisY} y2={axisY + 5} />
          <text x={x(au)} y={axisY + 19} textAnchor={i === ticks.length - 1 ? "end" : i === 0 ? "start" : "middle"}>
            {fmtSig(au, 1)}{i === ticks.length - 1 && ` ${t("а.е.", "AU")}`}
          </text>
        </g>
      ))}

      {placed.map((p, i) => {
        const r = planetDotRadius(p.radius_earth);
        const e = clampEcc(p.eccentricity);
        const isActive = active === p.name;
        const letter = planetLetter(p.name, star.name);
        const labelY = cy - r - 12 - lanes[i] * 16;
        return (
          <PlanetMark key={p.name} p={p} x={xs[i]} y={cy} r={r} active={isActive}
                      onActive={onActive} onOpen={() => open(p.name)}
                      label={`${p.name} · ${p.a_estimated ? "≈" : ""}${fmt(p.a_au, 3)} ${t("а.е.", "AU")}`}>
            {e > 0.02 && <line className="ss-ecc" x1={x(p.a_au * (1 - e))} x2={x(p.a_au * (1 + e))} y1={cy} y2={cy} />}
            {inHabitableZone(p.a_au, hz) && <circle className="ss-ring" cx={xs[i]} cy={cy} r={r + 3.5} />}
            {lanes[i] > 0 && <line className="ss-leader" x1={xs[i]} x2={xs[i]} y1={labelY + 4} y2={cy - r - 4} />}
            <text className="ss-name" x={xs[i]} y={labelY} textAnchor="middle">{letter}</text>
            {(dataFits[i] || isActive) && (
              <text className="ss-data" x={xs[i]} y={cy + r + 18} textAnchor={anchorAt(xs[i])}>{planetData(p, t)}</text>
            )}
          </PlanetMark>
        );
      })}

      {earthGhost && (
        <g className="ss-shift">
          <path d={`M${x(1)},${solarY - 5} Q${(x(1) + x(earthAu)) / 2},${solarY - 24} ${x(earthAu) + (earthAu >= 1 ? -3 : 3)},${solarY - 7}`}
                markerEnd={`url(#${id}-arrow)`} />
          {Math.abs(x(earthAu) - x(1)) > earthShift(earthAu, t).length * CHAR_PX + 24 && (
            <text x={(x(1) + x(earthAu)) / 2} y={solarY - 22} textAnchor="middle">{earthShift(earthAu, t)}</text>
          )}
        </g>
      )}

      {solar.length > 0 && (
        <g className="ss-solar">
          <text className="ss-solar-title" x={PAD} y={solarY - 12}>{t("Солнечная система для сравнения", "Solar System for comparison")}</text>
          <line x1={PAD} x2={width - PAD} y1={solarY} y2={solarY} />
          {solarMarks.map((s) => (
            <g key={s.en}>
              <circle cx={s.x} cy={solarY} r={2.5} />
              {s.show && <text x={s.x} y={solarY + 17} textAnchor={s.anchor}>{s.label}</text>}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
};

const Vertical = ({ geo, star, hz, width, active, onActive, open, id }) => {
  const t = useT();
  const { earthAu, starAu, placed, domain, solar, ticks, color } = geo;
  const top = 18;
  const axisX = 62;
  const decades = Math.log10(domain[1] / domain[0]);
  // тесные системы растягиваем, чтобы соседние планеты не слипались (но не бесконечно)
  const gaps = placed.slice(1).map((p, i) => Math.log10(p.a_au / placed[i].a_au)).filter((g) => g > 0);
  const perDecade = Math.min(Math.max(gaps.length ? 22 / Math.min(...gaps) : 0, 165), 230);
  const length = Math.round(decades * perDecade);
  const y = (au) => top + logX(domain, length)(au);
  const labelX = axisX + 22;

  const ys = placed.map((p) => y(p.a_au));
  const labelYs = stackLabels(ys.map((v) => v + 4), 20);
  const bottom = Math.max(top + length, ...labelYs) + 26;

  const starY = starAu ? y(starAu) : null;
  const big = width * 1.7;
  const starLabel = `${t("поверхность звезды", "star's surface")} · ${fmtSig(starAu, 2)} ${t("а.е.", "AU")}`;
  const starLabelInside = starY != null && starY - top > 30;

  // Подписи планет идут от оси вправо; у правого края — место Земли, зона и Солнечная
  // система. Правая подпись ищет свободную строку; не нашла — у соседней планеты прячутся цифры.
  const planetText = (p) => `${planetLetter(p.name, star.name)}  ${planetData(p, t)}`;
  const planetBoxes = placed.map((p, i) => ({ y: labelYs[i], x2: labelX + planetText(p).length * CHAR_PX, short: false }));
  const clashes = (ly, x1) => planetBoxes.filter((b) => Math.abs(b.y - ly) < 15 && b.x2 + 10 > x1);
  const right = [];
  const place = (key, text, candidates, required) => {
    const x1 = width - 8 - text.length * CHAR_PX;
    const free = (ly) => !clashes(ly, x1).length && right.every((r) => Math.abs(r.y - ly) >= 18);
    let ly = candidates.find(free);
    if (ly == null && !required) return;
    if (ly == null) {
      [ly] = candidates;
      clashes(ly, x1).forEach((b) => { b.short = true; });
    }
    right.push({ key, text, y: ly });
  };

  const earthY = earthAu ? y(earthAu) : null;
  const hzTop = hz ? y(hz.inner_conservative) : null;
  const hzBottom = hz ? y(hz.outer_conservative) : null;
  if (earthY != null) place("earth", t("место Земли", "Earth's place"), [earthY - 6, earthY + 15], true);
  if (hz && hzBottom - hzTop > 24) {
    place("hz", t("зона обитаемости", "habitable zone"), [hzTop + 16, hzBottom - 6], false);
  }
  const solarMarks = solar.map((s) => {
    const sy = y(s.a);
    const label = t(s.ru, s.en);
    const x1 = width - 14 - label.length * CHAR_PX;
    const show = !clashes(sy + 4, x1).length && right.every((r) => Math.abs(r.y - (sy + 4)) >= 18);
    if (show) right.push({ key: s.en, y: sy + 4 });
    return { ...s, y: sy, show, label };
  });
  const earthLabel = right.find((r) => r.key === "earth");
  const hzLabel = right.find((r) => r.key === "hz");

  return (
    <svg width={width} height={bottom} role="group" className="ss ss--vertical"
         aria-label={t("Система в масштабе: расстояния от звезды вниз по логарифмической шкале",
           "The system to scale: distance from the star runs down a logarithmic scale")}>
      <defs>
        <clipPath id={`${id}-band`}><rect x={0} y={0} width={width} height={bottom} /></clipPath>
        <Arrow id={id} />
      </defs>

      {hz && (
        <g>
          <rect className="ss-hz" x={axisX} y={y(hz.inner_optimistic)} width={width - axisX}
                height={Math.max(y(hz.outer_optimistic) - y(hz.inner_optimistic), 1)} fillOpacity={0.07} />
          <rect className="ss-hz" x={axisX} y={hzTop} width={width - axisX}
                height={Math.max(y(hz.outer_conservative) - hzTop, 1)} fillOpacity={0.13} />
          {hzLabel && <text className="ss-hz-label" x={width - 8} y={hzLabel.y} textAnchor="end">{hzLabel.text}</text>}
        </g>
      )}

      {ticks.map((au, i) => (
        <g key={au} className="ss-tick">
          <line className="ss-grid" x1={axisX - 4} x2={width} y1={y(au)} y2={y(au)} />
          <text x={axisX - 10} y={y(au) + 4} textAnchor="end">
            {fmtSig(au, 1)}{i === ticks.length - 1 && ` ${t("а.е.", "AU")}`}
          </text>
        </g>
      ))}
      <line className="ss-axis" x1={axisX} x2={axisX} y1={top} y2={top + length} />

      {starY != null && (
        <g clipPath={`url(#${id}-band)`}>
          <StarDisc id={id} cx={width / 2} cy={starY - big} r={big} color={color} />
        </g>
      )}
      {starY != null && (
        <text className={starLabelInside ? "ss-star-label is-inside" : "ss-star-label"}
              x={width / 2} y={starLabelInside ? starY - 12 : starY + 16} textAnchor="middle">
          {starLabel}
        </text>
      )}

      {earthY != null && (
        <g className="ss-earth">
          <line x1={axisX - 6} x2={width} y1={earthY} y2={earthY} />
          <text x={width - 8} y={earthLabel.y} textAnchor="end">{earthLabel.text}</text>
        </g>
      )}

      {earthY != null && solar.some((s) => s.en === "Earth") && Math.abs(earthY - y(1)) > 30 && (
        <g className="ss-shift">
          <path d={`M${width - 3},${y(1) + (earthY > y(1) ? 6 : -6)} L${width - 3},${earthY + (earthY > y(1) ? -3 : 3)}`}
                markerEnd={`url(#${id}-arrow)`} />
        </g>
      )}

      {solarMarks.map((s) => (
        <g key={s.en} className="ss-solar">
          <circle cx={width - 6} cy={s.y} r={2.5} />
          {s.show && <text x={width - 14} y={s.y + 4} textAnchor="end">{s.label}</text>}
        </g>
      ))}

      {placed.map((p, i) => {
        const r = planetDotRadius(p.radius_earth);
        const e = clampEcc(p.eccentricity);
        const letter = planetLetter(p.name, star.name);
        const moved = labelYs[i] - (ys[i] + 4) > 1;
        return (
          <PlanetMark key={p.name} p={p} x={axisX} y={ys[i]} r={r} active={active === p.name}
                      onActive={onActive} onOpen={() => open(p.name)}
                      label={`${p.name} · ${p.a_estimated ? "≈" : ""}${fmt(p.a_au, 3)} ${t("а.е.", "AU")}`}>
            {e > 0.02 && <line className="ss-ecc" x1={axisX} x2={axisX} y1={y(p.a_au * (1 - e))} y2={y(p.a_au * (1 + e))} />}
            {inHabitableZone(p.a_au, hz) && <circle className="ss-ring" cx={axisX} cy={ys[i]} r={r + 3.5} />}
            <polyline className="ss-leader" fill="none"
                      points={`${axisX + r + 4},${ys[i]} ${labelX - 6},${moved ? labelYs[i] - 4 : ys[i]}`} />
            <text className="ss-name" x={labelX} y={labelYs[i]}>
              {letter}
              {!planetBoxes[i].short && (
                <tspan className="ss-name__data" dx="8">{planetData(p, t)}</tspan>
              )}
            </text>
          </PlanetMark>
        );
      })}
    </svg>
  );
};

/**
 * Система «от поверхности звезды наружу»: край звезды в настоящем размере,
 * планеты по орбитам, зона обитаемости, место Земли и, серым, Солнечная система
 * на той же логарифмической оси. На узком экране ось вертикальная.
 */
const SystemStrip = ({ star, planets, hz, active = null, onActive = () => {} }) => {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const id = useId().replace(/:/g, "");
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useSystemGeometry(star, planets, hz);
  const open = (name) => navigate(`/results?name=${encodeURIComponent(name)}`);
  const props = { geo, star, hz, width, active, onActive, open, id };

  return (
    <div ref={wrapRef} className="w-full" data-testid="system-strip">
      {width > 0 && (width < VERTICAL_BELOW ? <Vertical {...props} /> : <Horizontal {...props} />)}
    </div>
  );
};

export default SystemStrip;
