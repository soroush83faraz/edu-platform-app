// /roadmap (owner, 2026-09-27): the product map as the Home's icon tiles — the delivered modules as live-blue tiles
// under «فعال», every coming module as a grey tile with the «به‌زودی» pill under its phase; a tap on a tile
// (`<details>`) reveals the month and the one-line description. The page reads the registry (no second list), links
// nowhere (least of all to an unbuilt route) and prints as a plain list.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => createElement("h2", null, title) }));

const { default: RoadmapPage } = await import("@/app/(app)/roadmap/page");
const { MODULES, PHASES, UPCOMING_MODULES } = await import("@/lib/modules-registry");

const html = renderToStaticMarkup(RoadmapPage());
const tilesOf = (markup: string) => [...markup.matchAll(/<details name="roadmap-module"[\s\S]*?<\/details>/g)].map((m) => m[0]);

describe("/roadmap — icon tiles", () => {
  const tiles = tilesOf(html);

  it("one tile per registry module, in the registry's order", () => {
    expect(tiles).toHaveLength(MODULES.length);
    MODULES.forEach((m, i) => expect(tiles[i]).toContain(`>${m.labelFa}</span>`));
  });

  it("delivered modules are live-blue tiles under «فعال»; coming ones grey with the «به‌زودی» pill", () => {
    const live = MODULES.filter((m) => m.phase === 1);
    tiles.slice(0, live.length).forEach((t) => {
      expect(t).toContain('data-shade="blue"');
      expect(t).not.toContain("به‌زودی</span>");
    });
    tiles.slice(live.length).forEach((t) => {
      expect(t).toContain('data-shade="grey"');
      expect(t).toMatch(/<span class="[^"]*text-xs[^"]*">به‌زودی<\/span>/);
    });
    expect(tiles.slice(live.length)).toHaveLength(UPCOMING_MODULES.length);
    expect(html).toContain(">فعال</span>");
    expect(html).toContain(">به‌زودی</span>");
  });

  it("each tile reveals its month and description; every phase keeps its anchor, title and months", () => {
    for (const m of UPCOMING_MODULES) {
      const t = tiles.find((x) => x.includes(`>${m.labelFa}</span>`))!;
      expect(t).toContain(m.descriptionFa);
      if (m.month) expect(t).toContain(`>${m.month}</span>`);
    }
    for (const phase of [2, 3, 4] as const) {
      expect(html).toContain(`id="phase-${phase}"`);
      expect(html).toContain(PHASES[phase].title);
      expect(html).toContain(PHASES[phase].months);
    }
  });

  it("links nowhere — no door to an unbuilt route, no href at all", () => {
    expect(html).not.toMatch(/<a |href=/);
    for (const m of UPCOMING_MODULES) expect(html).not.toContain(`"${m.href}"`);
  });

  it("prints: the tiles hide on paper and a plain list carries every description", () => {
    expect(html.match(/<ul class="[^"]*print:hidden/g)).toHaveLength(4);
    const printLists = [...html.matchAll(/<ul class="hidden [^"]*print:flex">([\s\S]*?)<\/ul>/g)].map((m) => m[1]).join("");
    for (const m of MODULES) expect(printLists).toContain(m.descriptionFa);
  });
});
