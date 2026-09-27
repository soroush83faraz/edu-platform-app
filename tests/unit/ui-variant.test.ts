// The experimental layout switch (owner trial, docs/decisions-pending/home-hub.md): `getUiVariant` reads the
// `donino-ui` cookie («hub» only when it says so — anything else, or no cookie, is «classic»), and the «ظاهر آزمایشی»
// toggle on «بیشتر» writes that same cookie for a year, site-wide, then reloads onto /home.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "donino-ui" && cookieValue !== undefined ? { name, value: cookieValue } : undefined) }) }));

const { getUiVariant, UI_VARIANT_COOKIE } = await import("@/lib/ui-variant");
const { UiVariantToggle, UI_VARIANT_COOKIE_NAME, writeUiVariantCookie } = await import("@/components/shell/UiVariantToggle");

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue = undefined;
});

describe("getUiVariant", () => {
  it("is «hub» only for the exact cookie value; missing or anything else is «classic»", async () => {
    expect(await getUiVariant()).toBe("classic");
    for (const [value, expected] of [
      ["hub", "hub"],
      ["classic", "classic"],
      ["HUB", "classic"],
      ["", "classic"],
    ] as const) {
      cookieValue = value;
      expect(await getUiVariant()).toBe(expected);
    }
  });
});

describe("«ظاهر آزمایشی» toggle", () => {
  it("the client mirror of the cookie name matches the server's", () => {
    expect(UI_VARIANT_COOKIE_NAME).toBe(UI_VARIANT_COOKIE);
  });

  it("writes the cookie for a year, site-wide, lax", () => {
    const doc = { cookie: "" };
    vi.stubGlobal("document", doc);
    writeUiVariantCookie("hub");
    expect(doc.cookie).toBe("donino-ui=hub; path=/; max-age=31536000; samesite=lax");
    writeUiVariantCookie("classic");
    expect(doc.cookie).toBe("donino-ui=classic; path=/; max-age=31536000; samesite=lax");
  });

  it("renders «کلاسیک / هاب» as a radio pair of 44 px segments, the current one checked", () => {
    for (const current of ["classic", "hub"] as const) {
      const html = renderToStaticMarkup(createElement(UiVariantToggle, { current }));
      expect(html).toContain("ظاهر آزمایشی");
      const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*aria-checked="(true|false)"[^>]*>([^<]+)<\/button>/g)].map((m) => ({ checked: m[1] === "true", label: m[2], tag: m[0] }));
      expect(radios.map((r) => r.label)).toEqual(["کلاسیک", "هاب"]);
      expect(radios.map((r) => r.checked)).toEqual([current === "classic", current === "hub"]);
      for (const r of radios) expect(r.tag).toContain("min-h-11");
    }
  });
});
