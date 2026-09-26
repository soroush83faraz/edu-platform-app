// Entrance animations once per browser session (src/lib/reveal-once.ts): the boot script leaves the first document
// load of a session animated and marks every later one `data-seen` before the first paint; the stylesheet scopes
// every entrance to `:root:not([data-seen])`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVEAL_BOOT_SCRIPT, REVEAL_SEEN_KEY } from "@/lib/reveal-once";

function boot(storage: Map<string, string> | "throws") {
  const dataset: Record<string, string> = {};
  const sessionStorage =
    storage === "throws"
      ? {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("blocked");
          },
        }
      : { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) };
  new Function("sessionStorage", "document", REVEAL_BOOT_SCRIPT)(sessionStorage, { documentElement: { dataset } });
  return dataset;
}

describe("REVEAL_BOOT_SCRIPT", () => {
  it("the first document load of a session animates and claims the session; the next one is `data-seen`", () => {
    const storage = new Map<string, string>();
    expect("seen" in boot(storage)).toBe(false);
    expect(storage.get(REVEAL_SEEN_KEY)).toBe("1");
    expect(boot(storage).seen).toBe("");
  });

  it("blocked storage falls through quietly: the page simply animates as before", () => {
    expect(() => boot("throws")).not.toThrow();
    expect("seen" in boot("throws")).toBe(false);
  });
});

describe("globals.css entrances", () => {
  const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
  it.each(["reveal", "reveal-stagger", "reveal-rows", "reveal-grid"])("%s animates only without `data-seen`", (name) => {
    const body = css.slice(css.indexOf(`@utility ${name} {`), css.indexOf("@utility", css.indexOf(`@utility ${name} {`) + 1));
    const animated = body.split("\n").filter((l) => /\{\s*$/.test(l) && !/@utility|@media/.test(l));
    expect(animated.length).toBeGreaterThan(0);
    for (const selector of animated) expect(selector).toContain(":root:not([data-seen])");
  });
});
