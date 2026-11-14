import { motion } from "framer-motion";
import { scoreColor } from "@/lib/format";

/**
 * Полукруглый SVG-датчик индекса обитаемости (0–100) с анимацией заполнения.
 */
const HabitabilityGauge = ({ score = 0, label, sublabel, size = 210 }) => {
  const stroke = size * 0.085;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const arcLen = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const color = scoreColor(clamped);

  const arc = (start, end) => {
    const sx = cx + r * Math.cos(Math.PI - start * Math.PI);
    const sy = cy - r * Math.sin(Math.PI - start * Math.PI);
    const ex = cx + r * Math.cos(Math.PI - end * Math.PI);
    const ey = cy - r * Math.sin(Math.PI - end * Math.PI);
    return `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;
  };

  return (
    <div className="relative select-none" style={{ width: size, height: size * 0.66 }}>
      <svg width={size} height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`}>
        <path
          d={arc(0, 1)}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <motion.path
          d={arc(0, 1)}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          initial={{ strokeDashoffset: arcLen }}
          animate={{ strokeDashoffset: arcLen * (1 - clamped / 100) }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 8px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-4xl font-bold text-white tabular" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {clamped.toFixed(0)}
          <span className="text-base text-slate-400 font-medium"> /100</span>
        </div>
        {label && (
          <div className="text-sm font-semibold mt-0.5" style={{ color }}>
            {label}
          </div>
        )}
        {sublabel && <div className="text-xs text-slate-400 mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
};

export default HabitabilityGauge;
