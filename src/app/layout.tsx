import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers";
import { ServiceWorkerRegistration } from "@/components/shell/ServiceWorkerRegistration";
import { productName } from "@/lib/product";
import { splashStartupImages } from "@/lib/pwa/splash";
import "./globals.css";

// Self-hosted Vazirmatn (variable, 100–900). NEVER import next/font/google (blocked in Iran).
// The Farsi-digits build ships only static weights, so digits are rendered via Intl('fa-IR').
const vazir = localFont({
  src: "../../node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-vazir",
});

// Every page sets only its own name («خانه»); the template appends the product («خانه | دانینو»), so the name
// lives in ONE place — `PRODUCT_NAME` / `src/lib/product.ts`.
export const metadata: Metadata = {
  title: { default: productName(), template: `%s | ${productName()}` },
  description: "سامانهٴ مدیریت آموزشی مدرسه",
  applicationName: productName(),
  manifest: "/manifest.webmanifest",
  // The Home Screen app on iOS (docs/pwa.md «نصب روی گوشی»): no Safari chrome, the page drawn under a translucent
  // status bar (white text) whose strip the body paints persian-blue, the product's name under the icon, and a
  // launch screen per device size instead of a white flash.
  appleWebApp: { capable: true, title: productName(), statusBarStyle: "black-translucent", startupImage: splashStartupImages() },
  // Next 16 renders `capable` as the standard `mobile-web-app-capable` only; iOS before 16.4 (which ignores the
  // manifest's `display`) still reads the apple-prefixed name, so it is spelled out once here.
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
};

// `theme-color` is persian-blue (primary-600): the Android status bar and the installed app's title strip.
// `viewport-fit=cover` lets the page reach under the notch; the shells pad themselves with the safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#072AC8",
};

// dir="rtl" lives ONLY here. Never set dir on inner elements except <bdi dir="ltr"> for phones/codes.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={`${vazir.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* The status-bar strip: on an iOS Home Screen app the page runs under a translucent status bar, so its
            area is painted here in the theme colour — the same persian-blue Android gives the bar from
            `theme-color`. Zero tall everywhere else (a browser tab, a desktop, Android): `safe-area-inset-top`
            is 0 there. Every shell pads its own top by the same inset, so nothing is drawn under it. */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-primary-600 print:hidden" />
        <AppProviders>{children}</AppProviders>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
