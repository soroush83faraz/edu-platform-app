import type { MetadataRoute } from "next";
import { productName } from "@/lib/product";

// Colours mirror src/app/globals.css: surface-sunken and primary-600.
export default function manifest(): MetadataRoute.Manifest {
  const name = productName();
  return {
    id: "/",
    name,
    short_name: name.length > 12 ? "مدرسه" : name,
    description: "پنل من، اعلان‌ها و مدیریت مدرسه — روی گوشی",
    lang: "fa",
    dir: "rtl",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F4F7FD",
    theme_color: "#072AC8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
