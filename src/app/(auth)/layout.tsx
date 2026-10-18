import type { Viewport } from "next";
import { AuthSky } from "@/components/auth/AuthSky";

/** The phone's status bar on the night door (the app behind it keeps the root's canvas colour). */
export const viewport: Viewport = { themeColor: "#0A1550" };

/**
 * The pre-app pages (login, forced/voluntary password change): «درِ تیره» — the owner's fixed dark door (2026-10-18,
 * docs/decisions.md; mock docs/mockups/login-v6.html). Not a theme and not dark mode: only these pages are dark, the
 * app after them stays light, nothing switches. `.auth-night` scopes the door's palette (src/app/globals.css), the sky
 * is a fixed, clipped layer behind everything, and the page itself never scrolls sideways (`overflow-x-clip`).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-night relative isolate flex min-h-dvh flex-1 flex-col overflow-x-clip">
      <AuthSky />
      {children}
    </main>
  );
}
