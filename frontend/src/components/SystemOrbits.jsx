import { useEffect, useRef } from "react";
import { starColor } from "@/lib/format";
import { AU_PER_SOLAR_RADIUS, planetLetter } from "@/lib/systemScale";

const GOLDEN_ANGLE = 2.39996;
const INNER_ORBIT_SECONDS = 6;

/**
 * Вид системы сверху в линейном масштабе. Скорости честные (относительно
 * периодов), а повороты орбит условные: в каталоге нет аргумента перицентра.
 */
const SystemOrbits = ({ star, planets, hz, height = 360 }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const placed = planets.filter((p) => p.a_au > 0);
    if (!placed.length) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const indigo = css.getPropertyValue("--data-indigo").trim() || "#818cf8";
    const rule = css.getPropertyValue("--rule").trim() || "rgba(148,163,253,0.11)";
    const ink3 = css.getPropertyValue("--ink-3").trim() || "#79849f";

    const orbits = placed.map((p, i) => {
      const e = Number.isFinite(p.eccentricity) ? Math.min(Math.max(p.eccentricity, 0), 0.9) : 0;
      return { ...p, e, tilt: i * GOLDEN_ANGLE, theta: i * 1.7 };
    });
    const fit = Math.max(...orbits.map((o) => o.a_au * (1 + o.e))) * 1.12;
    const minPeriod = Math.min(...orbits.map((o) => o.period_days || o.a_au ** 1.5 * 365.25));
    const starR = (star.radius || 0) * AU_PER_SOLAR_RADIUS;
    let W = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrapRef.current ? wrapRef.current.clientWidth : 600;
      canvas.width = W * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const point = (o, cx, cy, scale) => {
      const r = (o.a_au * (1 - o.e * o.e)) / (1 + o.e * Math.cos(o.theta));
      const ang = o.theta + o.tilt;
      return [cx + Math.cos(ang) * r * scale, cy + Math.sin(ang) * r * scale];
    };

    const draw = () => {
      const cx = W / 2;
      const cy = height / 2;
      const scale = Math.min(W, height) / 2 / fit;
      ctx.clearRect(0, 0, W, height);

      if (hz) {
        const ring = (a, b, alpha) => {
          ctx.beginPath();
          ctx.arc(cx, cy, b * scale, 0, Math.PI * 2);
          ctx.arc(cx, cy, a * scale, 0, Math.PI * 2, true);
          ctx.fillStyle = `rgba(34,197,94,${alpha})`;
          ctx.fill();
        };
        ring(hz.inner_optimistic, hz.outer_optimistic, 0.08);
        ring(hz.inner_conservative, hz.outer_conservative, 0.12);
      }

      ctx.lineWidth = 1;
      orbits.forEach((o) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(o.tilt);
        const b = o.a_au * Math.sqrt(1 - o.e * o.e);
        ctx.beginPath();
        ctx.ellipse(-o.a_au * o.e * scale, 0, o.a_au * scale, b * scale, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rule;
        ctx.stroke();
        ctx.restore();
      });

      // Звезда: в масштабе, если она видна, иначе точка с ореолом
      const sColor = starColor(star.temperature);
      const sr = Math.max(starR * scale, 4);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 3);
      glow.addColorStop(0, sColor);
      glow.addColorStop(0.33, sColor);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, sr * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      orbits.forEach((o) => {
        const [px, py] = point(o, cx, cy, scale);
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = indigo;
        ctx.fill();
        ctx.fillStyle = ink3;
        ctx.fillText(planetLetter(o.name, star.name), px + 6, py - 6);
      });
    };

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      orbits.forEach((o) => {
        const period = o.period_days || o.a_au ** 1.5 * 365.25;
        const mean = ((2 * Math.PI) / INNER_ORBIT_SECONDS) * (minPeriod / period) * dt;
        // второй закон Кеплера: у перицентра быстрее
        const k = (1 + o.e * Math.cos(o.theta)) ** 2 / (1 - o.e * o.e) ** 1.5;
        o.theta += mean * k;
      });
      draw();
      raf = requestAnimationFrame(step);
    };

    resize();
    draw();
    if (!reduced) raf = requestAnimationFrame(step);
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [star, planets, hz, height]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
};

export default SystemOrbits;
