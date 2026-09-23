// iOS launch screens (/splash/apple-splash-1179x2556.png …), one per device size in src/lib/pwa/splash.ts, rendered
// from the shared mark at build time — the <link rel="apple-touch-startup-image"> tags in src/app/layout.tsx point here.
import { renderSplash } from "@/lib/pwa/app-icon";
import { SPLASH_SCREENS, splashFile, splashSize } from "@/lib/pwa/splash";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): Array<{ file: string }> {
  return SPLASH_SCREENS.map((s) => ({ file: splashFile(s) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const size = splashSize(file);
  if (!size) return new Response(null, { status: 404 });
  return renderSplash(size.width, size.height, size.dpr);
}
