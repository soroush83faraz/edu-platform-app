import { useId } from "react";
import { MONOGRAM_PATH } from "@/lib/brand/mark";
import { cn } from "@/lib/cn";

/**
 * The glass «D» of the auth door (owner-approved mock docs/mockups/login-v6.html, `.orbit`): the brand monogram
 * (`MONOGRAM_PATH`, src/lib/brand/mark.ts — the one geometry) extruded in navy layers under a white → ice → sky face,
 * inside a halo with two tilted orbits, orbiting dots, two sparkles and a sheen that crosses the face every few
 * seconds. Hand-written inline SVG, no asset, no JS animation; size it with `className` (it fills its box).
 *
 * Three stacked layers so the motion stays cheap: the still body is painted once; the sheen (clipped to the D)
 * repaints only its own layer while it crosses; the dots turn as whole boxes (`.mark3d-orbit`), which the compositor
 * moves without repainting. All of it is still under `prefers-reduced-motion` (src/app/globals.css). Gradient ids are
 * per instance (`useId`) — the login page and the password page can never collide. Decorative by default.
 */
const PLACE = "translate(52 46) scale(1.5)";
/** The extrusion: twelve copies stepping down and to the right, the farthest first. */
const DEPTH = Array.from({ length: 12 }, (_, i) => 12 - i);
const step = (n: number) => n.toFixed(2);

export function DoninoMark3D({ className, title }: { className?: string; title?: string }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const ref = (name: string) => `m3d-${uid}-${name}`;
  const url = (name: string) => `url(#${ref(name)})`;
  return (
    <div
      className={cn("relative shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full overflow-visible" focusable="false" aria-hidden>
        <defs>
          <linearGradient id={ref("face")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset=".35" stopColor="#CFE8FF" />
            <stop offset="1" stopColor="#5AA9FF" />
          </linearGradient>
          <linearGradient id={ref("side")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2E4EE0" />
            <stop offset="1" stopColor="#0A1A7A" />
          </linearGradient>
          <radialGradient id={ref("halo")} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#3DA9FF" stopOpacity=".55" />
            <stop offset=".6" stopColor="#2E4EE0" stopOpacity=".18" />
            <stop offset="1" stopColor="#2E4EE0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ref("shade")} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#01041A" stopOpacity=".6" />
            <stop offset="1" stopColor="#01041A" stopOpacity="0" />
          </radialGradient>
          <path id={ref("mono")} d={MONOGRAM_PATH} fillRule="evenodd" />
        </defs>
        <circle cx="100" cy="100" r="98" fill={url("halo")} />
        {/* The drop under the D, drawn (a blur filter would repaint with every frame of the dots). */}
        <ellipse cx="106" cy="148" rx="50" ry="11" fill={url("shade")} />
        <ellipse cx="100" cy="100" rx="92" ry="34" fill="none" stroke="rgb(162 214 249 / .35)" strokeWidth="1.2" transform="rotate(-18 100 100)" />
        <ellipse cx="100" cy="100" rx="80" ry="26" fill="none" stroke="rgb(123 92 255 / .35)" strokeWidth="1" transform="rotate(24 100 100)" />
        <g transform={PLACE} fill={url("side")}>
          {DEPTH.map((k) => (
            <use key={k} href={`#${ref("mono")}`} transform={`translate(${step(0.35 * k)} ${step(0.55 * k)})`} />
          ))}
        </g>
        <use href={`#${ref("mono")}`} transform={PLACE} fill={url("face")} />
        <path d="M30 40 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4z" fill="#CFE8FF" />
        <path d="M168 158 l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8z" fill="#FFE27A" />
      </svg>
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full overflow-visible" focusable="false" aria-hidden>
        <defs>
          <linearGradient id={ref("sheen")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset=".5" stopColor="#FFFFFF" stopOpacity=".85" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <clipPath id={ref("clip")}>
            <path d={MONOGRAM_PATH} clipRule="evenodd" transform={PLACE} />
          </clipPath>
        </defs>
        <g clipPath={url("clip")}>
          <rect className="mark3d-sheen" x="-60" y="30" width="40" height="160" fill={url("sheen")} transform="rotate(20 100 100)" />
        </g>
      </svg>
      <svg viewBox="0 0 200 200" className="mark3d-orbit absolute inset-0 size-full overflow-visible" focusable="false" aria-hidden>
        <circle cx="192" cy="100" r="5" fill="#FFE27A" />
        <circle cx="8" cy="100" r="3.5" fill="#7CC3FF" />
      </svg>
      <svg viewBox="0 0 200 200" className="mark3d-orbit-rev absolute inset-0 size-full overflow-visible" focusable="false" aria-hidden>
        <circle cx="100" cy="22" r="3" fill="#B9A6FF" />
        <circle cx="100" cy="178" r="4" fill="#A2D6F9" />
      </svg>
    </div>
  );
}
