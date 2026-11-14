import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmt, fmtSig, starColor } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  AU_PER_SOLAR_RADIUS, SOLAR_REFERENCE, axisDomain, decadeTicks, inHabitableZone,
  labelLanes, logX, planetDotRadius, planetLetter,
} from "@/lib/systemScale";

const PAD_X = 14;
const LANE_H = 15;
const LABEL_TOP = 6;
const SOLAR_PRIORITY = ["Earth", "Jupiter", "Neptune", "Mercury", "Saturn", "Mars"];
const HZ_GREEN = "34,197,94";

/**
 * Линейка системы: звезда, зона обитаемости и планеты на одной
 * логарифмической оси в а.е. Под ней — Солнечная система для сравнения.
 * Шкала логарифмическая, иначе горячий юпитер и далёкий гигант
 * не помещаются на одну строку.
 */
const SystemRuler = ({ star, planets, hz }) => {
  const t = useT();
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const gradId = useId();
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const starRadiusAu = star.radius ? star.radius * AU_PER_SOLAR_RADIUS : null;
  const placed = planets.filter((p) => p.a_au > 0);
  const domain = axisDomain({ planets: placed, hz });
  const inner = Math.max(width - PAD_X * 2, 1);
  const x = (au) => PAD_X + logX(domain, inner)(au);

  const planetXs = placed.map((p) => x(p.a_au));
  const lanes = labelLanes(planetXs);
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
  const cy = LABEL_TOP + laneCount * LANE_H + 20;
  const axisY = cy + 22;
  const solarY = axisY + 50;
  const height = solarY + 24;
  const ticks = decadeTicks(domain);
  // Подпись планеты Солнечной системы — только если не налезает на предыдущую
  // Земля подписана всегда (о ней весь раздел), остальные — если есть место
  const shown = [];
  const solarLabels = SOLAR_REFERENCE.filter((s) => s.a >= domain[0] && s.a <= domain[1])
    .map((s) => ({ ...s, x: x(s.a) }));
  [...solarLabels].sort((a, b) => SOLAR_PRIORITY.indexOf(a.en) - SOLAR_PRIORITY.indexOf(b.en))
    .forEach((s) => {
      if (shown.every((o) => Math.abs(o.x - s.x) >= 58)) shown.push(s);
    });
  solarLabels.forEach((s) => {
    s.showLabel = shown.includes(s);
    s.anchor = s.x > width - PAD_X - 30 ? "end" : s.x < PAD_X + 30 ? "start" : "middle";
  });
  const starVisible = starRadiusAu > domain[0];
  const starX = starVisible ? x(starRadiusAu) : 4;
  const sColor = starColor(star.temperature);
  const open = (name) => navigate(`/results?name=${encodeURIComponent(name)}`);

  return (
    <figure ref={wrapRef} className="w-full" data-testid="system-ruler">
      {width > 0 && (
        <svg width={width} height={height} role="img"
             aria-label={t("Расстояния планет от звезды в астрономических единицах, логарифмическая шкала",
               "Planet distances from the star in astronomical units, logarithmic scale")}>
          {/* Звезда: край её диска стоит на своём реальном радиусе */}
          <defs>
            <clipPath id={`${gradId}-band`}>
              <rect x={0} y={LABEL_TOP} width={width} height={axisY - LABEL_TOP} />
            </clipPath>
            <linearGradient id={`${gradId}-limb`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={sColor} stopOpacity="0.04" />
              <stop offset="1" stopColor={sColor} stopOpacity="0.32" />
            </linearGradient>
          </defs>
          {/* Звезда: тонкая подсветка «внутри» и яркая линия её поверхности на реальном радиусе */}
          <g clipPath={`url(#${gradId}-band)`}>
            <rect x={0} y={LABEL_TOP} width={starX} height={axisY - LABEL_TOP} fill={`url(#${gradId}-limb)`} />
            <line x1={starX} x2={starX} y1={LABEL_TOP} y2={axisY} stroke={sColor} strokeWidth={6} strokeOpacity={0.25} />
            <line x1={starX} x2={starX} y1={LABEL_TOP} y2={axisY} stroke={sColor} strokeWidth={2} />
          </g>

          {hz && (
            <g>
              <rect x={x(hz.inner_optimistic)} y={LABEL_TOP} height={axisY - LABEL_TOP}
                    width={Math.max(x(hz.outer_optimistic) - x(hz.inner_optimistic), 1)}
                    fill={`rgba(${HZ_GREEN},0.10)`} />
              <rect x={x(hz.inner_conservative)} y={LABEL_TOP} height={axisY - LABEL_TOP}
                    width={Math.max(x(hz.outer_conservative) - x(hz.inner_conservative), 1)}
                    fill={`rgba(${HZ_GREEN},0.16)`} />
            </g>
          )}

          {/* Ось и десятичные засечки */}
          <line x1={PAD_X} x2={width - PAD_X} y1={axisY} y2={axisY} stroke="var(--rule)" />
          {ticks.map((au, i) => {
            const isLast = i === ticks.length - 1;
            return (
              <g key={au}>
                <line x1={x(au)} x2={x(au)} y1={axisY} y2={axisY + 5} stroke="var(--ink-4)" />
                <text x={x(au)} y={axisY + 18} textAnchor={isLast ? "end" : i === 0 ? "start" : "middle"}
                      className="sr-label" fill="var(--ink-3)">
                  {fmtSig(au, 1)}{isLast && ` ${t("а.е.", "AU")}`}
                </text>
              </g>
            );
          })}

          {/* Планеты: отрезок — от перицентра до апоцентра */}
          {placed.map((p, i) => {
            const e = Number.isFinite(p.eccentricity) ? Math.min(Math.max(p.eccentricity, 0), 0.95) : 0;
            const r = planetDotRadius(p.radius_earth);
            const habitable = inHabitableZone(p.a_au, hz);
            const labelY = cy - 16 - lanes[i] * LANE_H;
            return (
              <g key={p.name} className="sr-planet" tabIndex={0} role="link"
                 aria-label={`${p.name}, ${fmt(p.a_au, 3)} ${t("а.е.", "AU")}`}
                 onClick={() => open(p.name)}
                 onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), open(p.name))}>
                <title>{`${p.name} · ${p.a_estimated ? "≈" : ""}${fmt(p.a_au, 3)} ${t("а.е.", "AU")}`}</title>
                {e > 0.02 && (
                  <line x1={x(p.a_au * (1 - e))} x2={x(p.a_au * (1 + e))} y1={cy} y2={cy}
                        stroke="var(--data-indigo)" strokeOpacity={0.45} strokeWidth={2} />
                )}
                <line x1={planetXs[i]} x2={planetXs[i]} y1={labelY + 3} y2={cy - r}
                      stroke="var(--rule)" />
                <circle cx={planetXs[i]} cy={cy} r={r + 6} fill="transparent" />
                <circle className="sr-dot" cx={planetXs[i]} cy={cy} r={r}
                        fill="var(--data-indigo)"
                        stroke={habitable ? `rgb(${HZ_GREEN})` : "none"} strokeWidth={habitable ? 2 : 0} />
                <text className="sr-name" x={planetXs[i]} y={labelY} textAnchor="middle">
                  {planetLetter(p.name, star.name)}
                </text>
              </g>
            );
          })}

          {/* Солнечная система для сравнения */}
          <text x={width - PAD_X} y={solarY - 10} textAnchor="end" className="sr-label" fill="var(--ink-4)">
            {t("для сравнения: Солнечная система", "for comparison: the Solar System")}
          </text>
          <line x1={PAD_X} x2={width - PAD_X} y1={solarY} y2={solarY}
                stroke="var(--rule-soft)" strokeDasharray="2 4" />
          {solarLabels.map((s) => (
            <g key={s.en}>
              <circle cx={s.x} cy={solarY} r={2.5} fill="var(--ink-4)" />
              {s.showLabel && (
                <text x={s.x} y={solarY + 16} textAnchor={s.anchor} className="sr-label" fill="var(--ink-4)">
                  {t(s.ru, s.en)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      <figcaption className="sr-caption">
        {t("Шкала логарифмическая: каждое деление в 10 раз дальше предыдущего. Кружок — планета по размеру, отрезок — от ближней до дальней точки орбиты",
          "Logarithmic scale: each mark is ten times farther than the last. Circles are planets by size; a bar spans the orbit from nearest to farthest point")}
        {hz ? t(", зелёная полоса — зона обитаемости.", "; the green band is the habitable zone.") : "."}
        {starVisible &&
          ` ${t("Край звезды слева — в том же масштабе.", "The star's edge on the left is to the same scale.")}`}
        {!starVisible && starRadiusAu &&
          ` ${t("Сама звезда меньше начала шкалы.", "The star itself is smaller than the start of the scale.")}`}
        {planets.some((p) => p.a_estimated) &&
          ` ${t("Знак ≈ — расстояние посчитано по третьему закону Кеплера.", "≈ marks a distance computed from Kepler's third law.")}`}
      </figcaption>
    </figure>
  );
};

export default SystemRuler;
