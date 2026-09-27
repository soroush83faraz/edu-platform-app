// Prefetch within one frame only. Every signed-in route group draws its OWN shell in its layout — (app) and (public)
// through `AppShell`, /admin through its layout (the admin overview counts + `AppShell`) — so a `<Link>` whose target
// sits in another frame is prefetched by rendering that whole layout in the background: the request context, the
// summary counts, the admin overview, for a click that may never come (docs/decisions.md «navigation feel»). Inside
// one frame the shared layout is skipped and a prefetch stops at the target's `loading.tsx` — no database work.
// Cross-frame links keep working; they just fetch on click.

export type Frame = "admin" | "public" | "auth" | "app";

export function frameOf(path: string): Frame {
  const p = path.split(/[?#]/)[0];
  const under = (root: string) => p === root || p.startsWith(`${root}/`);
  if (under("/admin")) return "admin";
  if (under("/help") || under("/privacy")) return "public";
  if (under("/login") || under("/change-password")) return "auth";
  return "app";
}

/** The `prefetch` prop for a link from the page at `from` to `href`: the default inside one frame, off across frames. */
export function framePrefetch(from: string, href: string): false | undefined {
  return frameOf(from) === frameOf(href) ? undefined : false;
}
