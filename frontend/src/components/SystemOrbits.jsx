import { useEffect, useRef } from "react";
import { starColor } from "@/lib/format";
import { AU_PER_SOLAR_RADIUS, inHabitableZone, planetDotRadius, planetLetter } from "@/lib/systemScale";

const GOLDEN_ANGLE = 2.39996;
const INNER_ORBIT_SECONDS = 6;

/**
 * Вид системы сверху в линейном масштабе. Скорости честные (относительно
 * периодов), а повороты орбит условные: в каталоге нет аргумента перицентра.
 */
const SystemOrbits = ({ star, planets, hz, height = 360, centerX = 0.5 }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const placed = planets.filter((p) => p.a_au > 0);
    if (!placed.length) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const planetInk = css.getPropertyValue("--data-planet").trim() || "#c9cfe6";
    const rule = css.getPropertyValue("--rule").trim() || "rgba(148,163,253,0.11)";
    const ink3 = css.getPropertyValue("--ink-3").trim() || "#79849f";
    const habitable = css.getPropertyValue("--data-habitable").trim() || "#4ade80";
    const withAlpha = (hex, a) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

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
      const cx = W * centerX;
      const cy = height / 2;
      const room = Math.min(height / 2, cx, W - cx) - 14;
      const scale = Math.max(room, 40) / fit;
      ctx.clearRect(0, 0, W, height);

      if (hz) {
        const ring = (a, b, alpha) => {
          ctx.beginPath();
          ctx.arc(cx, cy, b * scale, 0, Math.PI * 2);
          ctx.arc(cx, cy, a * scale, 0, Math.PI * 2, true);
          ctx.fillStyle = withAlpha(habitable, alpha);
          ctx.fill();
        };
        ring(hz.inner_conservative, hz.outer_conservative, 0.05);
        // границы зоны — тонкими линиями, а не заливкой во всю сцену
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(habitable, 0.45);
        [hz.inner_conservative, hz.outer_conservative].forEach((a) => {
          ctx.beginPath();
          ctx.arc(cx, cy, a * scale, 0, Math.PI * 2);
          ctx.stroke();
        });
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

      // Звезда: диск в масштабе (не меньше 4px) и узкая корона — не размытое пятно
      const sColor = starColor(star.temperature);
      const sr = Math.max(starR * scale, 4);
      const corona = ctx.createRadialGradient(cx, cy, sr, cx, cy, sr * 1.6);
      corona.addColorStop(0, withAlpha(sColor, 0.35));
      corona.addColorStop(1, withAlpha(sColor, 0));
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, sr * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sColor;
      ctx.beginPath();
      ctx.arc(cx, cy, sr, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "500 12px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      orbits.forEach((o) => {
        const [px, py] = point(o, cx, cy, scale);
        const r = planetDotRadius(o.radius_earth) * 0.8;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = planetInk;
        ctx.fill();
        if (inHabitableZone(o.a_au, hz)) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = habitable;
          ctx.stroke();
        }
        ctx.fillStyle = ink3;
        ctx.fillText(planetLetter(o.name, star.name), px + r + 4, py - r - 2);
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
  }, [star, planets, hz, height, centerX]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
};

export default SystemOrbits;
