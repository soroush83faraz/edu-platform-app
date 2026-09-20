import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers";
import { ServiceWorkerRegistration } from "@/components/shell/ServiceWorkerRegistration";
import { productName } from "@/lib/product";
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

export const metadata: Metadata = {
  title: productName(),
  description: "سامانهٴ مدیریت آموزشی مدرسه",
  applicationName: productName(),
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: productName(), statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

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
        <AppProviders>{children}</AppProviders>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
