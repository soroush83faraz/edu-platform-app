import { cn } from "cn";

/**
 * The desktop dashboard / detail layout: one column on phones and tablets, a 12-column grid from `lg:` — the main
 * column takes 7 or 8 tracks, the aside 5 or 4 (`aside="wide"` = 5). The aside carries supporting panels
 * (`surface-panel`), the main column the page's work. Order in the DOM is main first, so phones read the work
 * before the supporting material. `asideFirst` renders the aside before the main column in the DOM (each slot
 * keeps its own column span) so it lands on the visual start side under `dir="rtl"` from `lg:` — the phone
 * (single-column) order is untouched, since phones stack top to bottom in DOM order regardless.
 */
export function TwoColumn({
  main,
  aside,
  asideWidth = "narrow",
  asideFirst = false,
  className,
}: {
  main: React.ReactNode;
  aside: React.ReactNode;
  asideWidth?: "narrow" | "wide";
  asideFirst?: boolean;
  className?: string;
}) {
  const wide = asideWidth === "wide";
  const mainEl = <div className={cn("flex min-w-0 flex-col gap-5", wide ? "lg:col-span-7" : "lg:col-span-8")}>{main}</div>;
  const asideEl = <aside className={cn("flex min-w-0 flex-col gap-5", wide ? "lg:col-span-5" : "lg:col-span-4")}>{aside}</aside>;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6", className)}>
      {asideFirst ? (
        <>
          {asideEl}
          {mainEl}
        </>
      ) : (
        <>
          {mainEl}
          {asideEl}
        </>
      )}
    </div>
  );
}
