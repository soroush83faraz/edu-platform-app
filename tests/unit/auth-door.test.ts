// «درِ تیره» (docs/decisions.md 2026-10-18; mock docs/mockups/login-v6.html): the dark auth door of /login and
// /change-password — what the login card says and keeps (LoginForm's fields, autocomplete, inputmode, the deep link,
// «خارج شدید.»), that the door is scoped (`.auth-night`, no theme, no `dark:`), that the glass «D» is the brand
// monogram with per-instance ids and moves only under `prefers-reduced-motion: no-preference`, and that the door's
// files use logical utilities only.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/iam/actions", () => ({
  loginFormAction: async () => null,
  changePasswordFormAction: async () => null,
  logoutAction: async () => undefined as never,
}));
vi.mock("@/modules/iam/demo-login/actions", () => ({ demoLoginFormAction: async () => null }));

const { default: AuthLayout } = await import("@/app/(auth)/layout");
const { DoninoMark3D } = await import("@/components/brand/DoninoMark3D");
const { MONOGRAM_PATH } = await import("@/lib/brand/mark");
const { ChangePasswordForm } = await import("@/modules/iam/ui/ChangePasswordForm");
const { LoginScene } = await import("@/modules/iam/ui/LoginScene");

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

describe("the login card", () => {
  const html = render(createElement(LoginScene, { loggedOut: false, next: "/inbox/0199", demo: null }));

  it("says «ورود به حساب» with no subtitle, the helper line and the two public links", () => {
    expect(html).toContain("ورود به حساب");
    expect(html).not.toContain("با شمارهٴ موبایل یا نام‌کاربری و رمزتان وارد شوید.");
    expect(html).toContain("رمز را فراموش کرده‌اید؟");
    expect(html).toContain("مدیر یا معاون مدرسه");
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("دانینو");
    expect(html).toContain("مدرسه‌تان، یک‌جا");
    expect(html).toContain("تکالیف، حضور و غیاب، کارنامه و مشاوره؛ همهٴ کار مدرسه در یک‌جا.");
    expect(html).not.toContain("ورود آزمایشی"); // no demo directory → no pill
  });

  it("keeps LoginForm's fields: identifier (ltr, tel, username, 64), password (current-password, 128), the deep link", () => {
    expect(html).toMatch(/<input id="identifier"[^>]*dir="ltr"[^>]*inputMode="tel"[^>]*autoComplete="username"[^>]*maxLength="64"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="current-password"[^>]*maxLength="128"[^>]*name="password"/);
    expect(html).toContain('<input type="hidden" name="next" value="/inbox/0199"/>');
    expect(html).toContain('aria-label="نمایش رمز"');
    expect(html).toMatch(/<button type="submit" class="auth-cta[^"]*">ورود<\/button>/);
    expect(html).toContain('role="alert"');
  });

  it("shows «خارج شدید.» after a logout", () => {
    const out = render(createElement(LoginScene, { loggedOut: true, next: null, demo: null }));
    expect(out).toMatch(/role="status"[^>]*>.*خارج شدید\./);
    expect(out).not.toContain('name="next"');
  });

  it("the password page keeps its four hints and three fields", () => {
    const form = render(createElement(ChangePasswordForm, { requireCurrent: true }));
    for (const name of ["currentPassword", "newPassword", "confirm"]) expect(form).toContain(`name="${name}"`);
    expect(form).toContain("دست‌کم ۸ نویسه");
    expect(form).toContain('aria-describedby="password-hints"');
    expect(render(createElement(ChangePasswordForm, { requireCurrent: false }))).not.toContain('name="currentPassword"');
  });
});

describe("the door is scoped, not a theme", () => {
  it("the (auth) layout wraps its pages in `.auth-night` with the fixed, clipped sky", () => {
    const html = render(createElement(AuthLayout, null, createElement("p", null, "x")));
    expect(html).toMatch(/<main class="auth-night [^"]*overflow-x-clip/);
    expect(html).toMatch(/class="auth-sky pointer-events-none fixed inset-0 -z-10 overflow-hidden"/);
    expect(html).toContain(MONOGRAM_PATH); // the faint ribbon
  });

  it("its palette lives under `.auth-night` and no `.dark` variant is involved", () => {
    expect(css).toMatch(/\.auth-night \{[^}]*--auth-text: #eef2ff;[^}]*color-scheme: dark;/);
    for (const file of [
      "src/app/(auth)/layout.tsx",
      "src/app/(auth)/login/page.tsx",
      "src/app/(auth)/change-password/page.tsx",
      "src/modules/iam/ui/LoginScene.tsx",
      "src/modules/iam/ui/LoginForm.tsx",
      "src/modules/iam/ui/PasswordInput.tsx",
      "src/modules/iam/ui/AuthField.tsx",
      "src/components/auth/AuthSky.tsx",
      "src/components/auth/AuthBrand.tsx",
    ]) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/\bdark:/);
      // Logical utilities only (CLAUDE.md): no physical margins/paddings/insets/alignment.
      expect(src, file).not.toMatch(/(?<![\w-])-?(?:ml|mr|pl|pr|left|right)-[\w[(.]/);
      expect(src, file).not.toMatch(/\btext-(?:left|right)\b/);
    }
  });
});

describe("DoninoMark3D — the glass «D»", () => {
  it("is the brand monogram, with gradient ids unique per instance", () => {
    const html = render(createElement("div", null, createElement(DoninoMark3D, { className: "size-40" }), createElement(DoninoMark3D, {})));
    expect(html).toContain(MONOGRAM_PATH);
    expect(html).not.toContain("<img");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1]);
    expect(html).toContain('aria-hidden="true"');
  });

  it("moves only under prefers-reduced-motion: no-preference", () => {
    const motion = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((x) => x[1]).join("\n");
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    for (const cls of [".mark3d-orbit", ".mark3d-orbit-rev", ".mark3d-sheen", ".auth-orb"]) {
      expect(motion).toContain(`${cls} {`);
      expect(outside).not.toMatch(new RegExp(`\\${cls} \\{[^}]*animation`));
    }
  });
});
