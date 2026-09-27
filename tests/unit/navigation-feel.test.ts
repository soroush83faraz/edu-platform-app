// Navigation feel (docs/decisions.md «navigation feel»): a click paints the route's `loading.tsx` at once, prefetches
// stay inside one frame (a cross-frame prefetch renders the target's whole layout in the background), and entity
// rows never prefetch (a list of 20 rows was 40 background requests per page view on a 0.1-CPU host).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameOf, framePrefetch } from "@/lib/frame-prefetch";

describe("frameOf / framePrefetch", () => {
  it("names the route group a path renders in", () => {
    expect(frameOf("/admin")).toBe("admin");
    expect(frameOf("/admin/people/0198c0de-0000-7000-8000-000000000000")).toBe("admin");
    expect(frameOf("/administrator")).toBe("app");
    expect(frameOf("/help")).toBe("public");
    expect(frameOf("/privacy#data")).toBe("public");
    expect(frameOf("/change-password")).toBe("auth");
    expect(frameOf("/home")).toBe("app");
    expect(frameOf("/inbox?bucket=today")).toBe("app");
  });

  it("keeps the default inside a frame and turns prefetch off across frames", () => {
    expect(framePrefetch("/home", "/inbox")).toBeUndefined();
    expect(framePrefetch("/admin/students", "/admin/staff")).toBeUndefined();
    expect(framePrefetch("/home", "/admin")).toBe(false);
    expect(framePrefetch("/admin", "/home")).toBe(false);
    expect(framePrefetch("/help", "/more")).toBe(false);
  });
});

const APP = join(process.cwd(), "src", "app");

describe("route-level loading states", () => {
  it("every top-level (app) section and the admin frame have a loading.tsx", () => {
    const sections = readdirSync(join(APP, "(app)"), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(sections.length).toBeGreaterThan(5);
    for (const d of sections) expect(existsSync(join(APP, "(app)", d.name, "loading.tsx")), `(app)/${d.name}/loading.tsx`).toBe(true);
    expect(existsSync(join(APP, "(admin)", "admin", "loading.tsx"))).toBe(true);
  });
});

describe("entity rows do not prefetch", () => {
  const ROW_FILES = [
    "src/modules/workspace/ui/InboxRow.tsx",
    "src/components/home/CompactItemRow.tsx",
    "src/components/admin/PeopleRows.tsx",
    "src/components/admin/ResourceTable.tsx",
    "src/components/timetable/WeekGrid.tsx",
    "src/components/timetable/WeekTimetable.tsx",
  ];
  it.each(ROW_FILES)("%s passes prefetch={false} to every Link", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const links = src.match(/<Link\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const tag of links) expect(tag, tag).toContain("prefetch={false}");
  });
});
