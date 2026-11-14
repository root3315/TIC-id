/**
 * CSS-портрет планеты: фактура подбирается по радиусу, температуре и плотности —
 * мини-нептуны с низкой плотностью рисуются газовыми, а не «землёй с континентами».
 * Лёгкий (без canvas), с кольцами для гигантов и ореолом атмосферы.
 */
const paletteFor = (radius, teq, gaseous) => {
  const r = radius ?? 1.5;
  const t = teq ?? 500;
  if (r >= 6) {
    // газовый гигант
    if (t > 1000) return { type: "giant", bands: ["#5b3a24", "#a86e3c", "#e0aa64", "#f6d6a0"] };
    if (t > 350) return { type: "giant", bands: ["#8c6e50", "#c8aa82", "#ebd2aa", "#b48c64"] };
    return { type: "giant", bands: ["#beaa8c", "#decbaa", "#aa9682", "#f0e4c8"] };
  }
  if (gaseous) {
    if (t > 800) return { type: "giant", bands: ["#7a5238", "#b4845a", "#dcb488", "#96684a"] };
    if (t > 330) return { type: "giant", bands: ["#4a6a96", "#6a8cb4", "#96b4d2", "#7a96ba"] };
    return { type: "giant", bands: ["#1e3e82", "#3064b4", "#5a96dc", "#8cbef0"] };
  }
  if (t > 800) return { type: "lava", base: "#2a1512", glowSpots: "#ff5a24" };
  if (t >= 240 && t <= 330) return { type: "terra", ocean: "#16498a", land: "#3f7a3c", cloud: "#f5f7fa" };
  if (t < 240) return { type: "ice", base: "#b8d2e8" };
  return { type: "desert", base: "#a87e58" };
};

const PlanetVisual = ({ radius, teq, mass, density, size = 200, className = "" }) => {
  const r = radius ?? 1.5;
  const d = density ?? (mass != null && radius != null && radius > 0
    ? (5.513 * mass) / radius ** 3
    : null);
  const gaseous = r >= 2.7 || (r >= 1.8 && (d == null ? r >= 2.2 : d < 4));
  const p = paletteFor(radius, teq, gaseous);
  const hasAtmo = r < 2.7 && teq != null && teq > 150 && teq < 420;
  const showRings = (radius ?? 0) >= 6;

  let surface = null;
  let bg = "#334155";
  if (p.type === "giant") {
    const [a, b, c, d] = p.bands;
    surface = (
      <div
        className="planet-bands"
        style={{
          background: `repeating-linear-gradient(8deg, ${a} 0 14%, ${b} 14% 26%, ${c} 26% 40%, ${d} 40% 52%, ${b} 52% 64%, ${a} 64% 78%, ${c} 78% 100%)`,
          filter: "blur(3px) saturate(1.05)",
        }}
      />
    );
    bg = p.bands[1];
  } else if (p.type === "lava") {
    bg = p.base;
    surface = (
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(18% 14% at 30% 40%, ${p.glowSpots} 0%, transparent 100%),
            radial-gradient(24% 16% at 62% 66%, ${p.glowSpots}cc 0%, transparent 100%),
            radial-gradient(14% 10% at 72% 30%, ${p.glowSpots}aa 0%, transparent 100%),
            radial-gradient(20% 12% at 42% 78%, ${p.glowSpots}bb 0%, transparent 100%)`,
          filter: "blur(1px)",
        }}
      />
    );
  } else if (p.type === "terra") {
    bg = p.ocean;
    surface = (
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(30% 24% at 30% 36%, ${p.land} 0%, transparent 100%),
            radial-gradient(34% 22% at 68% 58%, ${p.land} 0%, transparent 100%),
            radial-gradient(20% 16% at 48% 76%, ${p.land}dd 0%, transparent 100%),
            radial-gradient(40% 10% at 50% 6%, #ffffffee 0%, transparent 100%),
            radial-gradient(42% 10% at 50% 96%, #ffffffdd 0%, transparent 100%),
            radial-gradient(24% 8% at 36% 52%, ${p.cloud}b0 0%, transparent 100%),
            radial-gradient(30% 9% at 66% 30%, ${p.cloud}a0 0%, transparent 100%)`,
          filter: "blur(1.5px)",
        }}
      />
    );
  } else {
    bg = p.base;
    surface = (
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(26% 20% at 34% 40%, rgba(255,255,255,0.22) 0%, transparent 100%),
            radial-gradient(30% 22% at 64% 62%, rgba(0,0,0,0.25) 0%, transparent 100%),
            radial-gradient(18% 14% at 52% 26%, rgba(255,255,255,0.16) 0%, transparent 100%)`,
          filter: "blur(2px)",
        }}
      />
    );
  }

  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      aria-label="Иллюстрация планеты"
    >
      {showRings && (
        <div
          className="absolute left-1/2 top-1/2 pointer-events-none"
          style={{
            width: size * 1.9,
            height: size * 0.62,
            transform: "translate(-50%, -50%) rotate(-16deg)",
            borderRadius: "50%",
            border: `${Math.max(3, size * 0.03)}px solid rgba(214, 199, 170, 0.35)`,
            boxShadow: "0 0 18px rgba(214,199,170,0.18)",
            zIndex: 0,
          }}
        />
      )}
      <div
        className="planet-sphere w-full h-full"
        style={{
          background: bg,
          boxShadow: hasAtmo
            ? `inset -${size * 0.14}px -${size * 0.11}px ${size * 0.3}px rgba(0,0,6,0.85), inset ${size * 0.05}px ${size * 0.04}px ${size * 0.15}px rgba(255,255,255,0.18), 0 0 ${size * 0.12}px rgba(120,190,255,0.45)`
            : undefined,
          zIndex: 1,
        }}
      >
        {surface}
      </div>
      {showRings && (
        <div
          className="absolute left-1/2 top-1/2 pointer-events-none"
          style={{
            width: size * 1.9,
            height: size * 0.62,
            transform: "translate(-50%, -50%) rotate(-16deg)",
            borderRadius: "50%",
            borderBottom: `${Math.max(3, size * 0.03)}px solid rgba(224, 210, 182, 0.55)`,
            borderLeft: "none",
            borderTop: "none",
            borderRight: "none",
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
};

export default PlanetVisual;
