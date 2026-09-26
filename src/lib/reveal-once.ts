// The entrance animations (`reveal-stagger`, `reveal-rows`, `reveal-grid` in globals.css) play on the FIRST page
// view of a browser session only (UX review 2026-09-27, owner: a school app you open forty times a day should not
// rise in forty times). The switch is one attribute on <html>, `data-seen`, and the stylesheet scopes every
// entrance to `:root:not([data-seen])`.
//
// Two writers, because a "page view" arrives two ways:
//
// - a DOCUMENT load (first open, refresh, a hard link) runs `REVEAL_BOOT_SCRIPT` from the root layout while the
//   parser reads <body>, before the first paint: the first load of the session claims the key and leaves the
//   attribute off (the page rises in); every later load in the same session finds the key and sets `data-seen`
//   before anything is drawn, so nothing moves and nothing flashes;
// - a CLIENT-SIDE navigation never re-runs that script, so `RevealSession` (a client component in the root
//   layout) sets `data-seen` the moment the pathname first changes.
//
// No hydration mismatch: <html> carries `suppressHydrationWarning` for its own attributes, and React never renders
// `data-seen`, so it neither complains about it nor removes it. Storage disabled → the catch leaves the attribute
// off on document loads (they animate, as before) and the client-side rule still quiets every navigation.

/** `sessionStorage` key: set by the first document load of the session. */
export const REVEAL_SEEN_KEY = "donino.reveal.seen";

export const REVEAL_BOOT_SCRIPT = [
  "(function(){try{",
  `if(sessionStorage.getItem("${REVEAL_SEEN_KEY}")==="1"){document.documentElement.dataset.seen="";return}`,
  `sessionStorage.setItem("${REVEAL_SEEN_KEY}","1")`,
  "}catch(e){}})()",
].join("");
