import { cn } from "cn";

/**
 * The desktop dashboard / detail layout: one column on phones and tablets, a 12-column grid from `lg:` — the main
 * column takes 7 or 8 tracks, the aside 5 or 4 (`aside="wide"` = 5). The aside carries supporting panels
 * (`surface-panel`), the main column the page's work. Order in the DOM is main first, so phones read the work
 * before the supporting material.
 */
export function TwoColumn({ main, aside, asideWidth = "narrow", className }: { main: React.ReactNode; aside: React.ReactNode; asideWidth?: "narrow" | "wide"; className?: string }) {
  const wide = asideWidth === "wide";
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6", className)}>
      <div className={cn("flex min-w-0 flex-col gap-5", wide ? "lg:col-span-7" : "lg:col-span-8")}>{main}</div>
      <aside className={cn("flex min-w-0 flex-col gap-5", wide ? "lg:col-span-5" : "lg:col-span-4")}>{aside}</aside>
    </div>
  );
}
