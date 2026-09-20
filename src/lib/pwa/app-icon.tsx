// The app mark, drawn with plain divs so `ImageResponse` (satori) can rasterise it without fonts: a persian-blue
// rounded square, a white open book, a small yellow dot. Shared by app/icon.tsx, app/apple-icon.tsx and
// app/icons/[file]/route.tsx (the manifest's fixed URLs).
import { ImageResponse } from "next/og";

export const ICON_FILES = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "icon-512-maskable.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
} as const;

export type IconFile = keyof typeof ICON_FILES;

const BLUE = "#072AC8";
const SKY = "#0B6FD1";
const YELLOW = "#FFC600";

/**
 * `maskable` fills the whole square (the OS applies its own mask; the mark stays inside the 80% safe zone);
 * otherwise the square itself is rounded, as browser tabs and iOS expect.
 */
export function renderAppIcon(size: number, maskable = false): ImageResponse {
  const pad = maskable ? size * 0.2 : size * 0.16;
  const inner = size - pad * 2;
  const page = inner * 0.42;
  const pageH = inner * 0.66;
  const spine = Math.max(2, inner * 0.05);
  const dot = inner * 0.16;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${BLUE} 0%, ${SKY} 100%)`,
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ position: "relative", width: inner, height: inner, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* left page */}
          <div
            style={{
              position: "absolute",
              left: inner * 0.06,
              top: (inner - pageH) / 2,
              width: page,
              height: pageH,
              background: "#FFFFFF",
              borderRadius: `${inner * 0.06}px ${inner * 0.02}px ${inner * 0.02}px ${inner * 0.16}px`,
              transform: "skewY(-6deg)",
              opacity: 0.96,
            }}
          />
          {/* right page */}
          <div
            style={{
              position: "absolute",
              right: inner * 0.06,
              top: (inner - pageH) / 2,
              width: page,
              height: pageH,
              background: "#E4F3FD",
              borderRadius: `${inner * 0.02}px ${inner * 0.06}px ${inner * 0.16}px ${inner * 0.02}px`,
              transform: "skewY(6deg)",
            }}
          />
          {/* spine */}
          <div style={{ position: "absolute", left: (inner - spine) / 2, top: (inner - pageH) / 2 - inner * 0.03, width: spine, height: pageH + inner * 0.08, background: "#04135A", borderRadius: spine }} />
          {/* yellow dot */}
          <div style={{ position: "absolute", right: inner * 0.02, top: inner * 0.04, width: dot, height: dot, background: YELLOW, borderRadius: dot }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
