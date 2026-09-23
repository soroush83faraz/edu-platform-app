"use client";

/**
 * A script the browser runs WHILE PARSING the server's HTML — before the first paint, before any bundle — for the
 * few facts only the device knows and the first frame must already reflect (the opening splash's
 * `SPLASH_BOOT_SCRIPT`). The pattern is Next's own («Preventing flash before hydration»,
 * `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`):
 *
 * - on the server it is `text/javascript`, so the parser executes it in place;
 * - on the client it renders as `text/plain`, so React never creates a live script (and does not warn about
 *   one), and a client-side navigation never runs it a second time;
 * - `suppressHydrationWarning` accepts that `type` difference.
 *
 * The code is a string child, not `dangerouslySetInnerHTML` (ESLint `react/no-danger`); React writes it as the
 * element's text, which for a <script> is its source. Only ever pass a constant written in this repository —
 * never anything built from a request or from user input.
 */
export function InlineScript({ code }: { code: string }) {
  return (
    <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning>
      {code}
    </script>
  );
}
