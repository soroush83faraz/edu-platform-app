/**
 * A check mark that draws itself once when it mounts (`check-draw`, 300 ms; already drawn under reduced motion).
 * Same 24-unit geometry and 2 px stroke as lucide's `Check`, so it can stand in for it inside a button.
 */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" pathLength={1} className="check-draw" />
    </svg>
  );
}

/**
 * «همهٴ کارهای امروز انجام شد»: a persian-blue disc pops, a white check draws on it, and six short strokes — five
 * blue, one sky — spring out and fade (`burst` in globals.css, ≤ 600 ms in all). No glow; 32 px.
 */
export function CheckBurst({ className }: { className?: string }) {
  const rays = [0, 60, 120, 180, 240, 300];
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} fill="none" strokeLinecap="round" className={["burst shrink-0", className].filter(Boolean).join(" ")} aria-hidden>
      {rays.map((deg, i) => (
        <line
          key={deg}
          className={`burst-ray ${i === 1 ? "stroke-sky" : "stroke-primary-600"}`}
          x1={16}
          y1={3.5}
          x2={16}
          y2={1}
          strokeWidth={2}
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
      <circle className="burst-disc fill-primary-600" cx={16} cy={16} r={10} />
      <path d="M11.5 16.2l3 3 6-6.4" pathLength={1} className="check-draw stroke-white" strokeWidth={2.25} strokeLinejoin="round" />
    </svg>
  );
}
