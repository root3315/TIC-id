import { useEffect, useRef } from "react";

/**
 * Космический фон в два слоя:
 *  — статичный canvas: полоса Млечного Пути и слабые туманности
 *  — анимированный canvas: мерцающие звёзды с медленным дрейфом
 * Уважает prefers-reduced-motion.
 */
const Starfield = () => {
  const staticRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const sCanvas = staticRef.current;
    const aCanvas = animRef.current;
    const sctx = sCanvas.getContext("2d");
    const actx = aCanvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let stars = [];
    let w = 0;
    let h = 0;

    const paintStatic = () => {
      sctx.clearRect(0, 0, w, h);

      // туманности
      const nebulae = [
        { x: w * 0.82, y: h * 0.18, r: Math.max(w, h) * 0.38, c: "99, 102, 241" },   // индиго
        { x: w * 0.12, y: h * 0.75, r: Math.max(w, h) * 0.34, c: "34, 211, 238" },   // бирюза
        { x: w * 0.45, y: h * 0.05, r: Math.max(w, h) * 0.26, c: "192, 132, 252" },  // фиолет
      ];
      for (const n of nebulae) {
        const g = sctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(${n.c}, 0.10)`);
        g.addColorStop(0.5, `rgba(${n.c}, 0.04)`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, w, h);
      }

      // полоса Млечного Пути: облако слабых звёзд вдоль диагонали
      const rng = (seed) => {
        let s = seed;
        return () => {
          s = (s * 16807) % 2147483647;
          return (s - 1) / 2147483646;
        };
      };
      const rand = rng(42);
      const cx = w * 0.55;
      const cy = h * 0.4;
      const angle = -0.5; // радианы
      const len = Math.hypot(w, h) * 0.75;
      const width = Math.min(w, h) * 0.22;
      for (let i = 0; i < 1400; i += 1) {
        const t = (rand() - 0.5) * len;
        // гауссово поперёк полосы
        const gInner = (rand() + rand() + rand() - 1.5) / 1.5;
        const d = gInner * width;
        const x = cx + t * Math.cos(angle) - d * Math.sin(angle);
        const y = cy + t * Math.sin(angle) + d * Math.cos(angle);
        if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
        const bright = 20 + rand() * 90;
        const size = rand() < 0.92 ? 0.6 : 1.1;
        sctx.beginPath();
        sctx.arc(x, y, size, 0, Math.PI * 2);
        sctx.fillStyle = `rgba(${190 + rand() * 60}, ${200 + rand() * 50}, 255, ${bright / 255})`;
        sctx.fill();
      }
      // мягкое свечение полосы
      const bandGrad = sctx.createLinearGradient(
        cx - Math.sin(angle) * width * 2, cy + Math.cos(angle) * width * 2,
        cx + Math.sin(angle) * width * 2, cy - Math.cos(angle) * width * 2
      );
      bandGrad.addColorStop(0, "rgba(148,163,253,0)");
      bandGrad.addColorStop(0.5, "rgba(190,200,255,0.045)");
      bandGrad.addColorStop(1, "rgba(148,163,253,0)");
      sctx.fillStyle = bandGrad;
      sctx.fillRect(0, 0, w, h);
    };

    const init = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      for (const [canvas, ctx] of [[sCanvas, sctx], [aCanvas, actx]]) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const count = Math.min(300, Math.floor((w * h) / 5200));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.35 + 0.35,
        base: Math.random() * 0.55 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 1.2 + 0.4,
        drift: Math.random() * 0.016 + 0.004,
        hue: Math.random() < 0.12 ? 265 : Math.random() < 0.3 ? 190 : 220,
      }));
      paintStatic();
    };

    const draw = (t) => {
      actx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin((t / 900) * s.speed + s.phase);
        actx.beginPath();
        actx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        actx.fillStyle = `hsla(${s.hue}, 80%, 85%, ${s.base * tw})`;
        actx.fill();
        if (!reduced) {
          s.y += s.drift;
          if (s.y > h + 2) s.y = -2;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    init();
    if (reduced) {
      draw(0);
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }
    window.addEventListener("resize", init);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", init);
    };
  }, []);

  return (
    <>
      <canvas ref={staticRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true" />
      <canvas ref={animRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true" />
    </>
  );
};

export default Starfield;
