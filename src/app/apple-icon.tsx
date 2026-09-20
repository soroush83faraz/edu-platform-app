// <link rel="apple-touch-icon"> — iOS rounds the corners itself, so the mark is drawn edge to edge.
import { renderAppIcon } from "@/lib/pwa/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180, true);
}
