// <link rel="icon"> in two sizes (favicon tab + Android home screen fallback). See src/lib/pwa/app-icon.tsx.
import { renderAppIcon } from "@/lib/pwa/app-icon";

export function generateImageMetadata() {
  return [
    { id: "32", contentType: "image/png", size: { width: 32, height: 32 } },
    { id: "192", contentType: "image/png", size: { width: 192, height: 192 } },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const size = Number(await id);
  return renderAppIcon(size === 32 ? 32 : 192);
}
