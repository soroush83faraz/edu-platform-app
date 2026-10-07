import { useId } from "react";

/**
 * «برگه و تیک» — a sheet with a blue check disc: the empty «تکالیف این درس» (mock class-page-v3, screen 3). Inline SVG
 * on a 160×110 grid, palette colours only (the persian-blue scale, sky), no assets. Decorative by default
 * (`aria-hidden`); `size` is the rendered width.
 */
export function SheetCheckIllustration({ size = 168, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={Math.round((size * 110) / 160)}
      viewBox="0 0 160 110"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-blob`} cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="#DCE4FF" />
          <stop offset="1" stopColor="#EEF2FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-chk`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4C6BF0" />
          <stop offset="1" stopColor="#072AC8" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="58" rx="66" ry="46" fill={`url(#${id}-blob)`} />
      <g transform="rotate(-6 76 56)">
        <rect x="52" y="20" width="50" height="64" rx="9" fill="#C9D5F7" />
        <rect x="50" y="17" width="50" height="64" rx="9" fill="#FFFFFF" />
        <rect x="60" y="31" width="30" height="5" rx="2.5" fill="#B9C8FF" />
        <rect x="60" y="42" width="24" height="5" rx="2.5" fill="#DCE4FF" />
        <rect x="60" y="53" width="28" height="5" rx="2.5" fill="#DCE4FF" />
      </g>
      <circle cx="101" cy="76" r="15" fill={`url(#${id}-chk)`} />
      <path d="M94 76 l5 5 9-10" stroke="#FFFFFF" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M118 30 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2z" fill="#1E96FC" />
      <path d="M36 52 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5z" fill="#B9C8FF" />
      <circle cx="122" cy="58" r="2.6" fill="#B9C8FF" />
    </svg>
  );
}
