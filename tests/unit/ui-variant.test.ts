// The layout switch after the owner adopted the hub (2026-09-27, docs/decisions-pending/home-hub.md): `getUiVariant`
// is «hub» for everyone — a leftover `donino-ui=classic` cookie from the trial is ignored — and «بیشتر» no longer
// offers the «ظاهر آزمایشی» toggle. The classic branches stay reachable only by editing that one function.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
const cookies = vi.hoisted(() => vi.fn(async () => ({ get: (name: string) => (jar.value !== undefined ? { name, value: jar.value } : undefined) })));
vi.mock("next/headers", () => ({ cookies }));

const { getUiVariant } = await import("@/lib/ui-variant");

describe("getUiVariant", () => {
  it("is «hub» for everyone, whatever the old trial cookie says", async () => {
    for (const value of [undefined, "hub", "classic", "HUB", ""]) {
      jar.value = value;
      expect(await getUiVariant()).toBe("hub");
    }
    // It does not even read the cookie: the switch is the function itself, not a per-viewer preference.
    expect(cookies).not.toHaveBeenCalled();
  });
});

describe("no way to switch back from the UI", () => {
  it("«بیشتر» has no «ظاهر آزمایشی» toggle, and the toggle component is gone", () => {
    const more = readFileSync(new URL("../../src/app/(app)/more/page.tsx", import.meta.url), "utf8");
    expect(more).not.toContain("UiVariantToggle");
    expect(more).not.toContain("ظاهر آزمایشی");
    expect(existsSync(new URL("../../src/components/shell/UiVariantToggle.tsx", import.meta.url))).toBe(false);
  });
});
