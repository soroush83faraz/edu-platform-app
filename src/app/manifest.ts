import type { MetadataRoute } from "next";
import { productName } from "@/lib/product";

// The installed app (docs/pwa.md «نصب روی گوشی»). Colours mirror src/app/globals.css: `canvas` — the page ground,
// so the launch splash hands over to the first paint without a colour jump — and primary-600 (persian-blue) for the
// status bar / title strip.
export default function manifest(): MetadataRoute.Manifest {
  const name = productName();
  return {
    id: "/",
    name,
    // «دانینو» is 6 characters, so the product's own name is its own short name; a long `PRODUCT_NAME` override
    // falls back to the category word, which is what a launcher can fit.
    short_name: name.length > 12 ? "مدرسه" : name,
    description: "پنل من، اعلان‌ها و مدیریت مدرسه — روی گوشی",
    lang: "fa",
    dir: "rtl",
    // `id` stays "/" — the identity every install so far was registered under; changing it would orphan them.
    // `start_url` is Home, inside `scope` (the whole origin), so no in-app link ever falls out into a browser tab.
    start_url: "/home",
    scope: "/",
    // No browser chrome: `standalone` is what the owner asked for (no address bar, no tab strip). A browser that
    // cannot do standalone gets `minimal-ui` (back / reload only) before it would fall back to a full tab.
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#E8EEF9",
    theme_color: "#072AC8",
    // `any` icons carry the squircle's own corners; the `maskable` one is full-bleed with the mark in the 80 %
    // safe zone, for Android launchers that cut their own shape (src/lib/pwa/app-icon.tsx).
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
