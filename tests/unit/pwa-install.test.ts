// The installed app opens without browser chrome (owner: «the address bar is ugly»). What makes that true is data —
// the manifest's display fields and the iOS launch-screen table — so it is pinned here; the head tags themselves
// are Next's rendering of `metadata.appleWebApp` in src/app/layout.tsx (docs/pwa.md «نصب روی گوشی»).
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { SPLASH_SCREENS, splashFile, splashMedia, splashSize, splashStartupImages } from "@/lib/pwa/splash";

describe("the web manifest", () => {
  const m = manifest();

  it("asks for a chrome-free window, falling back to minimal-ui — never a browser tab", () => {
    expect(m.display).toBe("standalone");
    expect(m.display_override).toEqual(["standalone", "minimal-ui"]);
  });

  it("keeps its identity, starts on Home and owns the whole origin", () => {
    expect(m.id).toBe("/");
    expect(m.start_url).toBe("/home");
    expect(m.scope).toBe("/");
  });

  it("paints the status bar persian-blue and the splash on the page ground", () => {
    expect(m.theme_color).toBe("#072AC8");
    expect(m.background_color).toBe("#E8EEF9");
    expect(m.name).toBe("دانینو");
    expect(m.short_name).toBe("دانینو");
  });

  it("carries an `any` icon set and a maskable one", () => {
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
    expect(m.icons?.find((i) => i.purpose === "maskable")).toMatchObject({ src: "/icons/icon-512-maskable.png", sizes: "512x512" });
  });
});

describe("iOS launch screens", () => {
  it("one file per device size, named by its device pixels, portrait only", () => {
    const files = SPLASH_SCREENS.map(splashFile);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain("apple-splash-1179x2556.png");
    for (const s of SPLASH_SCREENS) {
      expect(s.height).toBeGreaterThan(s.width);
      expect(splashMedia(s)).toContain("(orientation: portrait)");
      expect(splashSize(splashFile(s))).toEqual({ width: s.width * s.dpr, height: s.height * s.dpr, dpr: s.dpr });
    }
    expect(splashSize("apple-splash-1x1.png")).toBeNull();
  });

  it("the layout's startup links point at the splash route with a device media query", () => {
    const links = splashStartupImages();
    expect(links).toHaveLength(SPLASH_SCREENS.length);
    expect(links[0]).toEqual({
      url: "/splash/apple-splash-1320x2868.png",
      media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    });
  });
});
