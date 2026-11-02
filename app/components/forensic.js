import { TOKENS } from './tokens.js';

// Shared forensic primitives for the Deep Intel shell: SVG gauge ring,
// for/against stance bar, and the telemetry ribbon under the header.
export function GaugeRing({ value, label }) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  const radius = 26;
  const circle = 2 * Math.PI * radius;
  const percent = Math.round(clamped * 100);
  return (
    <div className="gauge" role="img" aria-label={`${label}: ${percent} percent`}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} fill="none" stroke={TOKENS.border} strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={TOKENS.primary}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${clamped * circle} ${circle}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div>
        <div className="gauge-num">{percent}%</div>
        <div className="gauge-lab">{label}</div>
      </div>
    </div>
  );
}

export function StanceBar({ sup, con }) {
  const total = sup + con;
  if (!total) return null;
  return (
    <div className="stancebar" role="img" aria-label={`${sup} for, ${con} against`}>
      <div className="for" style={{ width: `${(sup / total) * 100}%` }} />
      <div className="against" style={{ width: `${(con / total) * 100}%` }} />
    </div>
  );
}


