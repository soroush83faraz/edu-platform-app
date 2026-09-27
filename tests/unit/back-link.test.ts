// The «بازگشت» control (owner, nav round 2026-09-27): one `BackLink` for `PageHeader`'s `back` and the public
// pages' `PublicBackLink` — primary-700 semibold text after a right-pointing chevron (RTL: back is towards the
// start), a quiet `surface-sunken` pill with a hairline, 44 px tall, never a filled button.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackLink } from "@/components/layout/BackLink";

describe("BackLink", () => {
  const html = renderToStaticMarkup(createElement(BackLink, { href: "/inbox", label: "پنل من" }));

  it("links back with its label after a ChevronRight", () => {
    expect(html).toMatch(/^<a[^>]*href="\/inbox"/);
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("lucide-arrow-right");
    expect(html.indexOf("lucide-chevron-right")).toBeLessThan(html.indexOf("پنل من"));
  });

  it("is clearly visible yet quiet: primary-700 semibold on a tinted pill, 44 px, no filled blue", () => {
    const cls = /class="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];
    for (const c of ["text-sm", "text-primary-700", "font-semibold", "min-h-11", "rounded-full", "bg-surface-sunken", "ring-1"]) expect(cls).toContain(c);
    expect(cls.some((c) => /^bg-primary-(5|6|7|8|9)00$/.test(c))).toBe(false);
    expect(cls).not.toContain("text-text-muted");
    expect(cls.some((c) => /^lg:min-h-(9|10)$/.test(c))).toBe(false);
  });

  it("is the ONE rendering: PageHeader and PublicBackLink both draw it", () => {
    for (const file of ["layout/PageHeader.tsx", "shell/PublicBackLink.tsx"]) {
      const src = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), "utf8");
      expect(src).toContain("<BackLink");
      expect(src).not.toContain("ArrowRight");
    }
  });
});
