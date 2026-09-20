import { useId } from "react";

/**
 * Soft-3D ("clay") illustrations: hand-written SVG, palette colours only, no assets, no JS. Each one is a rounded
 * body with a top-light gradient, an inner highlight and a blurred shadow ellipse. `size` is the rendered width;
 * every drawing is authored on a 120×120 grid. Decorative by default (`aria-hidden`); pass `title` to label it.
 */
export interface ClayProps {
  size?: number;
  className?: string;
  title?: string;
}

const P = {
  blue: "#072AC8",
  blueDeep: "#04135A",
  sky: "#1E96FC",
  icy: "#A2D6F9",
  icySoft: "#E4F3FD",
  yellow: "#FFC600",
  yellowDeep: "#E0A800",
  white: "#FFFFFF",
  navy: "#0B1440",
  red: "#C0392B",
};

function Frame({ size = 120, className, title, children, ids }: ClayProps & { children: React.ReactNode; ids: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${ids}-b`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={P.sky} />
          <stop offset="1" stopColor={P.blue} />
        </linearGradient>
        <linearGradient id={`${ids}-i`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.white} />
          <stop offset="1" stopColor={P.icy} />
        </linearGradient>
        <linearGradient id={`${ids}-y`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE066" />
          <stop offset="1" stopColor={P.yellow} />
        </linearGradient>
        <radialGradient id={`${ids}-hl`} cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stopColor={P.white} stopOpacity="0.55" />
          <stop offset="1" stopColor={P.white} stopOpacity="0" />
        </radialGradient>
        <filter id={`${ids}-sh`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <ellipse cx="60" cy="106" rx="34" ry="7" fill={P.blue} opacity="0.18" filter={`url(#${ids}-sh)`} />
      {children}
    </svg>
  );
}

/** A tray with a sheet sliding in — کارتابل. */
export function InboxClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <rect x="34" y="18" width="52" height="60" rx="8" fill={`url(#${ids}-i)`} />
      <rect x="44" y="30" width="32" height="4" rx="2" fill={P.icy} />
      <rect x="44" y="40" width="24" height="4" rx="2" fill={P.icy} />
      <path d="M18 60h26l6 10h20l6-10h26v30a12 12 0 0 1-12 12H30a12 12 0 0 1-12-12z" fill={`url(#${ids}-b)`} />
      <path d="M18 60h26l6 10h20l6-10h26v30a12 12 0 0 1-12 12H30a12 12 0 0 1-12-12z" fill={`url(#${ids}-hl)`} />
      <circle cx="84" cy="24" r="9" fill={`url(#${ids}-y)`} />
    </Frame>
  );
}

/** Bell with a yellow dot — اعلان‌ها. */
export function BellClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M60 18c-16 0-26 12-26 28v14l-9 14h70l-9-14V46c0-16-10-28-26-28z" fill={`url(#${ids}-b)`} />
      <path d="M60 18c-16 0-26 12-26 28v14l-9 14h70l-9-14V46c0-16-10-28-26-28z" fill={`url(#${ids}-hl)`} />
      <rect x="48" y="80" width="24" height="14" rx="7" fill={P.blueDeep} />
      <circle cx="84" cy="32" r="10" fill={`url(#${ids}-y)`} />
    </Frame>
  );
}

/** A small school building with a yellow door — مدیریت. */
export function SchoolClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M22 54l38-26 38 26v40a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8z" fill={`url(#${ids}-i)`} />
      <path d="M16 56l44-30 44 30" fill="none" stroke={`url(#${ids}-b)`} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="50" y="70" width="20" height="32" rx="6" fill={`url(#${ids}-y)`} />
      <rect x="32" y="66" width="12" height="12" rx="3" fill={P.sky} />
      <rect x="76" y="66" width="12" height="12" rx="3" fill={P.sky} />
      <circle cx="60" cy="52" r="6" fill={P.blue} />
    </Frame>
  );
}

/** Rocket — به‌زودی / نقشهٴ راه. */
export function RocketClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M60 14c14 10 22 30 22 52l-22 14-22-14c0-22 8-42 22-52z" fill={`url(#${ids}-i)`} />
      <path d="M38 62l-14 16 16-2z M82 62l14 16-16-2z" fill={`url(#${ids}-b)`} />
      <circle cx="60" cy="48" r="10" fill={`url(#${ids}-b)`} />
      <circle cx="60" cy="48" r="5" fill={P.icySoft} />
      <path d="M52 82h16l-8 20z" fill={`url(#${ids}-y)`} />
    </Frame>
  );
}

/** A phone with a plus badge — نصب برنامه. */
export function PhoneInstallClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <rect x="36" y="12" width="48" height="90" rx="12" fill={`url(#${ids}-b)`} />
      <rect x="36" y="12" width="48" height="90" rx="12" fill={`url(#${ids}-hl)`} />
      <rect x="42" y="22" width="36" height="66" rx="6" fill={`url(#${ids}-i)`} />
      <rect x="48" y="30" width="24" height="4" rx="2" fill={P.icy} />
      <rect x="48" y="38" width="16" height="4" rx="2" fill={P.icy} />
      <circle cx="82" cy="78" r="14" fill={`url(#${ids}-y)`} />
      <path d="M82 71v14M75 78h14" stroke={P.navy} strokeWidth="3.5" strokeLinecap="round" />
    </Frame>
  );
}

/** A cloud with a cut cord — آفلاین. */
export function OfflineClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M36 82a16 16 0 0 1-2-32 22 22 0 0 1 42-8 16 16 0 0 1 12 40z" fill={`url(#${ids}-i)`} />
      <path d="M36 82a16 16 0 0 1-2-32 22 22 0 0 1 42-8 16 16 0 0 1 12 40z" fill="none" stroke={`url(#${ids}-b)`} strokeWidth="5" />
      <path d="M30 96l60-64" stroke={P.red} strokeWidth="6" strokeLinecap="round" />
      <path d="M30 96l60-64" stroke={P.white} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </Frame>
  );
}

/** An empty open folder — حالت خالی. */
export function EmptyClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M20 40a8 8 0 0 1 8-8h22l8 8h34a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" fill={`url(#${ids}-b)`} />
      <path d="M14 56a6 6 0 0 1 6-6h80a6 6 0 0 1 6 6l-6 32a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" fill={`url(#${ids}-i)`} />
      <path d="M14 56a6 6 0 0 1 6-6h80a6 6 0 0 1 6 6l-6 32a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" fill={`url(#${ids}-hl)`} />
      <circle cx="92" cy="30" r="7" fill={`url(#${ids}-y)`} />
    </Frame>
  );
}

/** An open book — the login hero and the app mark. */
export function BookClay(props: ClayProps) {
  const ids = useId();
  return (
    <Frame {...props} ids={ids}>
      <path d="M20 34c14-6 28-6 40 2v54c-12-8-26-8-40-2z" fill={`url(#${ids}-b)`} />
      <path d="M100 34c-14-6-28-6-40 2v54c12-8 26-8 40-2z" fill={`url(#${ids}-i)`} />
      <path d="M20 34c14-6 28-6 40 2v54c-12-8-26-8-40-2z" fill={`url(#${ids}-hl)`} />
      <path d="M70 50c8-3 16-3 24-1M70 62c8-3 16-3 24-1M70 74c8-3 16-3 24-1" stroke={P.icy} strokeWidth="4" strokeLinecap="round" fill="none" />
      <rect x="58" y="34" width="4" height="56" rx="2" fill={P.blueDeep} />
      <circle cx="30" cy="24" r="8" fill={`url(#${ids}-y)`} />
    </Frame>
  );
}
