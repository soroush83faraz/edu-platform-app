import { cn } from "cn";
import { MONOGRAM_PATH, MONOGRAM_VIEWBOX } from "@/lib/brand/mark";
import { DEFAULT_PRODUCT_NAME, PRODUCT_NAME_LATIN } from "@/lib/product";

/**
 * The «دانینو» monogram — the owner's logo, hand-written as inline SVG (no asset, no dependency): an outer rounded
 * D whose stem carries a second, smaller D inside its counter, one navy ribbon spiralling inwards. The geometry
 * lives in `src/lib/brand/mark.ts` so the installed PWA icon (`src/lib/pwa/app-icon.tsx`) is the SAME drawing —
 * white on the persian-blue squircle there, navy on white here.
 *
 * It fills with `currentColor` and defaults to the `primary-700` navy token, so a caller recolours it by putting a
 * text colour on it (`text-white` over the hero gradient) and never by editing the path. Decorative by default;
 * pass `title` to label it. `size` is the rendered width in pixels — 24 (compact), 32/36 (headers), 40 (the rail).
 */
export function DoninoMark({ size = 40, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MONOGRAM_VIEWBOX}
      className={cn("shrink-0 text-primary-700", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={MONOGRAM_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * The wordmark: the monogram beside the product's name, with an optional second line (the school, in the rail).
 *
 * `name` is passed in rather than read from `productName()` so the rail — a Client Component — can render the
 * `PRODUCT_NAME` override too; it defaults to «دانینو». `script` picks the wordmark under the mark: `"fa"` (the
 * default) is the Persian «دانینو» in Vazirmatn, the app's own font, and is the ONLY one the Persian UI uses;
 * `"latin"` is the lowercase «donino» of the printed logo, for the rare surface where a Latin string is already
 * acceptable — never as a UI label. The one place the product introduces itself: the desktop rail, the auth
 * pages, `/~offline`.
 */
export function DoninoWordmark({
  name = DEFAULT_PRODUCT_NAME,
  sub,
  size = 36,
  script = "fa",
  className,
}: {
  name?: string;
  sub?: React.ReactNode;
  size?: number;
  script?: "fa" | "latin";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <DoninoMark size={size} />
      <span className="flex min-w-0 flex-col">
        {script === "latin" ? (
          <bdi dir="ltr" className="truncate text-row font-bold tracking-wide text-primary-700 lowercase">
            {PRODUCT_NAME_LATIN}
          </bdi>
        ) : (
          <span className="truncate text-row font-bold text-text">{name}</span>
        )}
        {sub ? <span className="truncate text-meta text-text-muted">{sub}</span> : null}
      </span>
    </span>
  );
}
