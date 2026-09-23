// The installed app's mark — the SAME drawing as `DoninoMark`: the geometry lives in `src/lib/brand/mark.ts` and
// reaches satori as an SVG data URI inside an <img> (satori has no CSS variables and no component of ours, so the
// mark is handed to it as a self-contained picture). Shared by app/icon.tsx, app/apple-icon.tsx,
// app/icons/[file]/route.tsx (the manifest's fixed URLs) and app/splash/[file]/route.tsx (the iOS launch screens).
import { ImageResponse } from "next/og";
import { MARK_CANVAS, markDataUri } from "@/lib/brand/mark";

export const ICON_FILES = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "icon-512-maskable.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
} as const;

export type IconFile = keyof typeof ICON_FILES;

/**
 * `maskable` fills the whole square and keeps the mark inside the 80 % safe zone (the OS applies its own mask);
 * otherwise the squircle's own 26 % corners are drawn, as browser tabs and iOS expect. Both cases are one
 * full-bleed image — the viewBox does the framing (see `markSvg`).
 */
export function renderAppIcon(size: number, maskable = false): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>; next/image has no place here. */}
        <img src={markDataUri(maskable)} width={size} height={size} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * An iOS launch screen (`src/lib/pwa/splash.ts`): the installed icon — the same squircle the Home Screen shows —
 * centred on the page ground, so the jump from tapping the icon to the first paint is the icon growing into the
 * app, never a white flash. Sized off the short side (26 %), so a phone and an iPad read alike. No text: satori
 * would not join Persian letters, and the name is under the icon on the Home Screen already.
 */
export function renderSplash(width: number, height: number): ImageResponse {
  const mark = Math.round(Math.min(width, height) * 0.26);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width, height, alignItems: "center", justifyContent: "center", background: MARK_CANVAS }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>; next/image has no place here. */}
        <img src={markDataUri(false)} width={mark} height={mark} alt="" />
      </div>
    ),
    { width, height },
  );
}
