// When the opening splash («دانینو» written by one pen — `src/components/brand/SplashScreen.tsx`) may play, and the
// four lines of boot script that decide it BEFORE the first paint.
//
// Two rules, both the owner's. It belongs to the INSTALLED app: a browser tab has its own chrome and its own
// loading, and a public page or `/login` in a tab must never be covered by it. And it plays ONCE per session — the
// first document load of the installed app, whichever route it lands on; a refresh, a client-side navigation back
// to «خانه», anything after that gets nothing until the app is closed and opened again.
//
// The decision cannot wait for React: the overlay is in the server-rendered HTML so it is painted with the first
// frame, which means the answer «no» has to arrive BEFORE that frame or a browser tab would flash it. So the
// answer is written by `SPLASH_BOOT_SCRIPT`, an inline script at the top of `<body>` that the parser runs before
// it reaches the overlay: it sets `data-splash="on"` on `<html>` only when both rules say yes, and the stylesheet
// lays the overlay out only under that attribute. `shouldShowSplash` is the same decision as a pure function —
// the readable, tested statement of what the script does.

/** `sessionStorage` key. Session-scoped on purpose: closing the app window is what earns the next splash. */
export const SPLASH_SEEN_KEY = "donino.splash.seen";

/** How long the pen writes, the drop falls, the ink lands and the water rings out and calms, before the layer
 *  lifts away (`SPLASH_FADE_MS`). */
export const SPLASH_HOLD_MS = 1850;
export const SPLASH_FADE_MS = 350;
/** The hard cap: the CSS `splash-leave` runs exactly this long, so even a dead bundle cannot leave it standing. */
export const SPLASH_TOTAL_MS = SPLASH_HOLD_MS + SPLASH_FADE_MS;
/** With `prefers-reduced-motion: reduce`: the still, solid mark stands and fades (`splash-leave-still`). */
export const SPLASH_REDUCED_MS = 500;

export interface SplashEnv {
  /** The app is installed: `display-mode: standalone` / `minimal-ui`, or iOS's `navigator.standalone`. */
  standalone: boolean;
  /** This session has already had its splash (the key above is set). */
  seenThisSession: boolean;
}

export function shouldShowSplash(env: SplashEnv): boolean {
  return env.standalone && !env.seenThisSession;
}

/**
 * The same decision, self-contained, for the inline `<script>` in the root layout — it runs before any bundle, so
 * it cannot import the function above. It CLAIMS the session (writes the key) the moment it says yes, before a
 * single frame is painted, so no later load and no client-side navigation can start a second one. Anything
 * unexpected — storage disabled, a locked-down WebView — falls through the `catch` and simply shows nothing.
 */
export const SPLASH_BOOT_SCRIPT = [
  "(function(){try{",
  'var m=window.matchMedia,s=!!(m&&(m("(display-mode: standalone)").matches||m("(display-mode: minimal-ui)").matches))||window.navigator.standalone===true;',
  "if(!s)return;",
  `if(sessionStorage.getItem("${SPLASH_SEEN_KEY}")==="1")return;`,
  `sessionStorage.setItem("${SPLASH_SEEN_KEY}","1");`,
  'document.documentElement.dataset.splash="on"',
  "}catch(e){}})()",
].join("");
