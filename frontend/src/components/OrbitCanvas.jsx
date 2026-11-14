import { useEffect, useRef } from "react";
import { starColor } from "@/lib/format";

/**
 * Интерактивная анимация орбиты: планета движется по кеплеровской орбите
 * вокруг звезды, зелёным показана зона обитаемости (если рассчитана).
 */
const OrbitCanvas = ({ a, e = 0, hz, starTeff, planetName, height = 460 }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!a || a <= 0) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let theta = 0;
    const trail = [];
    const ecc = Math.max(0, Math.min(0.95, e || 0));
    const apo = a * (1 + ecc);
    const fit = Math.max(apo, hz?.outer_optimistic || 0) * 1.18;
    const sColor = starColor(starTeff);
    let dpr = 1;
    let W = 0;
    let H = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrapRef.current ? wrapRef.current.clientWidth : 600;
      H = height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rOf = (th) => (a * (1 - ecc * ecc)) / (1 + ecc * Math.cos(th));

    const draw = () => {
      const cx = W / 2;
      const cy = H / 2;
      const scale = Math.min(W, H) / 2 / fit;
      ctx.clearRect(0, 0, W, H);

      // Зона обитаемости
      if (hz) {
        const ring = (inner, outer, color) => {
          ctx.beginPath();
          ctx.arc(cx, cy, outer * scale, 0, Math.PI * 2);
          ctx.arc(cx, cy, inner * scale, 0, Math.PI * 2, true);
          ctx.fillStyle = color;
          ctx.fill();
        };
        ring(hz.inner_optimistic * scale > 0 ? hz.inner_optimistic : 0, hz.outer_optimistic, "rgba(34,197,94,0.10)");
        ring(hz.inner_conservative, hz.outer_conservative, "rgba(34,197,94,0.16)");
      }

      // Масштабные окружности
      const step = 10 ** Math.floor(Math.log10(fit));
      ctx.strokeStyle = "rgba(148,163,184,0.16)";
      ctx.fillStyle = "rgba(148,163,184,0.55)";
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.setLineDash([3, 5]);
      for (let m = step; m < fit; m += step) {
        ctx.beginPath();
        ctx.arc(cx, cy, m * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${parseFloat(m.toPrecision(2))} а.е.`, cx + m * scale * 0.7071 + 4, cy - m * scale * 0.7071 - 4);
      }
      ctx.setLineDash([]);

      // Орбита
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 2 + 0.02; t += 0.02) {
        const r = rOf(t) * scale;
        const x = cx + r * Math.cos(t);
        const y = cy + r * Math.sin(t);
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(34,211,238,0.55)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Звезда с ореолом
      const starR = Math.max(7, Math.min(16, 10 * scale * 0.05 + 8));
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 3.4);
      glow.addColorStop(0, `${sColor}cc`);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, starR * 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, starR, 0, Math.PI * 2);
      ctx.fillStyle = sColor;
      ctx.fill();

      // След планеты
      for (let i = 0; i < trail.length; i += 1) {
        const p = trail[i];
        const alpha = (i / trail.length) * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56,189,248,${alpha})`;
        ctx.fill();
      }

      // Планета
      const r = rOf(theta) * scale;
      const px = cx + r * Math.cos(theta);
      const py = cy + r * Math.sin(theta);
      const pGlow = ctx.createRadialGradient(px, py, 0, px, py, 16);
      pGlow.addColorStop(0, "rgba(56,189,248,0.7)");
      pGlow.addColorStop(1, "transparent");
      ctx.fillStyle = pGlow;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = "#38bdf8";
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
      if (planetName) {
        ctx.fillStyle = "rgba(226,232,240,0.9)";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(planetName, px + 12, py - 10);
      }

      trail.push({ x: px, y: py });
      if (trail.length > 90) trail.shift();

      // Кеплер: скорость выше в перицентре (dθ ∝ 1/r²)
      const rNorm = rOf(theta) / a;
      theta += (0.014 / (rNorm * rNorm)) * (reduced ? 0 : 1);
      if (theta > Math.PI * 2) theta -= Math.PI * 2;

      raf = requestAnimationFrame(draw);
    };

    resize();
    if (reduced) {
      theta = Math.PI / 3;
      draw();
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [a, e, hz, starTeff, planetName, height]);

  if (!a || a <= 0) return null;

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="w-full rounded-xl" style={{ height }} />
    </div>
  );
};

export default OrbitCanvas;
