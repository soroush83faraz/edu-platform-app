// The installed app's mark — the SAME drawing as `DoninoMark`: the geometry lives in `src/lib/brand/mark.ts` and
// reaches satori as an SVG data URI inside an <img> (satori has no CSS variables and no component of ours, so the
// mark is handed to it as a self-contained picture). Shared by app/icon.tsx, app/apple-icon.tsx,
// app/icons/[file]/route.tsx (the manifest's fixed URLs) and app/splash/[file]/route.tsx (the iOS launch screens).
import { ImageResponse } from "next/og";
import { MARK_CANVAS, ghostMarkDataUri, markDataUri } from "@/lib/brand/mark";

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
 * An iOS launch screen (`src/lib/pwa/splash.ts`): the monogram alone, pale persian-blue on the page ground — the
 * still the OS holds while the app starts, and ALSO the first frame of the opening splash
 * (`src/components/brand/SplashScreen.tsx`), where the pen then writes over it. Same ground (`canvas`), same mark
 * (`ghostMarkSvg`), same size — `min(40vmin, 280px)` there is 40 % of the short side capped at 280 CSS pixels
 * here — so the hand-over from the OS to the page is invisible. No text: the mark alone, the owner's call.
 */
export function renderSplash(width: number, height: number, dpr: number): ImageResponse {
  const mark = Math.round(Math.min(Math.min(width, height) * 0.4, 280 * dpr));
  return new ImageResponse(
    (
      <div style={{ display: "flex", width, height, alignItems: "center", justifyContent: "center", background: MARK_CANVAS }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>; next/image has no place here. */}
        <img src={ghostMarkDataUri()} width={mark} height={mark} alt="" />
      </div>
    ),
    { width, height },
  );
}
