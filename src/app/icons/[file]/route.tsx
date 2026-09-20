// Fixed-URL PNG icons for the web manifest (/icons/icon-192.png …), rendered from the shared mark at build time.
import { ICON_FILES, type IconFile, renderAppIcon } from "@/lib/pwa/app-icon";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): Array<{ file: IconFile }> {
  return (Object.keys(ICON_FILES) as IconFile[]).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const spec = ICON_FILES[file as IconFile];
  if (!spec) return new Response(null, { status: 404 });
  return renderAppIcon(spec.size, spec.maskable);
}
