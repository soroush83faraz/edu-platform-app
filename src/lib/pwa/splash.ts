// iOS launch screens («apple-touch-startup-image»). Safari has no manifest-driven splash: an app added to the Home
// Screen shows a WHITE screen while it starts unless the page names one image per exact device size, matched by a
// media query. This is the table of those sizes (portrait only — the manifest locks `orientation: portrait`), and
// the one place both sides read it: `src/app/layout.tsx` turns it into `appleWebApp.startupImage` links, and
// `src/app/splash/[file]/route.tsx` renders each PNG from the same mark as the icons (`renderSplash` in
// `src/lib/pwa/app-icon.tsx`) — no image in the repository, nothing from another host.
//
// Pure data, no `next/og` import, so the root layout can read it without pulling the image renderer into its bundle.

export interface SplashScreen {
  /** CSS pixels, portrait. */
  width: number;
  height: number;
  /** `-webkit-device-pixel-ratio`. */
  dpr: 2 | 3;
}

/** Every iPhone with a notch or a Dynamic Island since the X, the 4.7″ / 5.5″ home-button phones, and the iPads. */
export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { width: 440, height: 956, dpr: 3 }, // iPhone 16 Pro Max
  { width: 402, height: 874, dpr: 3 }, // iPhone 16 Pro
  { width: 430, height: 932, dpr: 3 }, // iPhone 14 Pro Max, 15 Plus / Pro Max, 16 Plus
  { width: 393, height: 852, dpr: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { width: 428, height: 926, dpr: 3 }, // iPhone 12 / 13 Pro Max, 14 Plus
  { width: 390, height: 844, dpr: 3 }, // iPhone 12, 13, 14 (and Pro)
  { width: 375, height: 812, dpr: 3 }, // iPhone X, XS, 11 Pro, 12 / 13 mini
  { width: 414, height: 896, dpr: 3 }, // iPhone XS Max, 11 Pro Max
  { width: 414, height: 896, dpr: 2 }, // iPhone XR, 11
  { width: 414, height: 736, dpr: 3 }, // iPhone 6 / 7 / 8 Plus
  { width: 375, height: 667, dpr: 2 }, // iPhone 6 / 7 / 8, SE 2nd / 3rd gen
  { width: 1024, height: 1366, dpr: 2 }, // iPad Pro 12.9″
  { width: 834, height: 1194, dpr: 2 }, // iPad Pro 11″
  { width: 820, height: 1180, dpr: 2 }, // iPad Air, iPad 10th gen
  { width: 810, height: 1080, dpr: 2 }, // iPad 7th–9th gen
  { width: 744, height: 1133, dpr: 2 }, // iPad mini 6th gen
];

/** The PNG's own name — its size in device pixels, the one thing that tells two screens apart. */
export function splashFile(s: SplashScreen): string {
  return `apple-splash-${s.width * s.dpr}x${s.height * s.dpr}.png`;
}

/** The media query iOS matches the launch image by. */
export function splashMedia(s: SplashScreen): string {
  return `(device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`;
}

/** `appleWebApp.startupImage` for the root layout. */
export function splashStartupImages(): Array<{ url: string; media: string }> {
  return SPLASH_SCREENS.map((s) => ({ url: `/splash/${splashFile(s)}`, media: splashMedia(s) }));
}

/** Device-pixel size of a splash file name (with the ratio that produced it), or null for an unknown name. */
export function splashSize(file: string): { width: number; height: number; dpr: number } | null {
  const s = SPLASH_SCREENS.find((x) => splashFile(x) === file);
  return s ? { width: s.width * s.dpr, height: s.height * s.dpr, dpr: s.dpr } : null;
}
