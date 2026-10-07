import { BackLink } from "@/components/layout/BackLink";
import { TopBarBack } from "@/components/shell/TopBarBack";
import { cn } from "@/lib/cn";
import { formatJalaliLong } from "@/lib/format";
import { SchoolsMenu } from "@/components/layout/SchoolsMenu";
import { getShellContext } from "@/lib/shell-context";
import { getUiVariant, type UiVariant } from "@/lib/ui-variant";

/**
 * The header of every page, one DOM in two shapes. On phones: the back link (classic only), the title (`text-title`)
 * with the actions at its end, then the description. From `lg:` the same nodes settle into a slim header bar —
 * the context line «مدرسه · سال · نوبت» (the organization admin: «سازمان · سال») at the start, today's Jalali date and the page's primary action at the
 * end, a hairline under it — with the title (`text-display`) and description beneath. The action node moves
 * between the two rows through `grid-area`, so nothing is rendered twice and nothing is portalled after hydration.
 * `count` sits beside the title as a quiet tabular number (list pages). Context is read once per request.
 * `hideTitle` keeps the title for assistive tech only: on phones the whole header is then visually gone (a page
 * the bottom nav already names, e.g. «کلاس من»), from `lg:` only the context bar shows.
 * The way back is `back` — the page's logical parent, declared once here (`pageBack` resolves it). In the «hub»
 * layout (everyone's — docs/decisions-pending/home-hub.md) every page leads back: with no `back` given it is «خانه» →
 * /home, and the pill is drawn in the TOP BAR's start slot (`TopBarBack`, owner 2026-10-06), never as a row of the
 * page body; `back={false}` opts out — Home itself. In «classic» the link stays a row above the title, and no `back`
 * = no link.
 */
const HOME_BACK = { href: "/home", label: "خانه" } as const;

export function pageBack(
  back: { href: string; label: string } | false | undefined,
  variant: UiVariant,
): { href: string; label: string; place: "bar" | "body" } | null {
  if (back === false) return null;
  if (variant === "hub") return { ...(back ?? HOME_BACK), place: "bar" };
  return back ? { ...back, place: "body" } : null;
}

/** The page header (see the module notes above `pageBack`). */
export async function PageHeader({
  title,
  description,
  count,
  back,
  actions,
  className,
  titleAs: TitleTag = "h2",
  hideTitle = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  count?: number | string;
  back?: { href: string; label: string } | false;
  actions?: React.ReactNode;
  className?: string;
  titleAs?: "h1" | "h2";
  hideTitle?: boolean;
}) {
  const shell = await getShellContext();
  const way = pageBack(back, await getUiVariant());
  const backLink = way?.place === "body" ? way : null;
  // More than one school in the caller's scope: the chip replaces the name and opens the list (`SchoolsMenu`).
  // The organization admin's context is the ORGANIZATION (owner, 2026-09-27: never a school, even the only one) —
  // its name leads, then the chip when there are several schools, then the year they share; no single نوبت.
  const schoolsPart = shell.schools.length > 1 ? <SchoolsMenu key="schools" schools={shell.schools} /> : shell.schoolName;
  const context: React.ReactNode[] = [shell.orgScoped ? shell.orgName : null, schoolsPart, shell.yearName, shell.termName].filter(Boolean);
  return (
    <>
    {way?.place === "bar" ? <TopBarBack href={way.href} label={way.label} /> : null}
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 pt-4",
        // Phones: the title always gets its own full-width row, so a long title (or the count beside it) never
        // has to share space with the actions and shrink into overlap/truncation (owner report, `/admin/schools`
        // count overlapping the title at 375 px). Actions that don't fit the title's row wrap onto their own row
        // underneath instead.
        "[grid-template-areas:'back_back'_'title_title'_'actions_actions'_'desc_desc']",
        "lg:pt-0 lg:[grid-template-areas:'context_actions'_'back_back'_'title_title'_'desc_desc']",
        hideTitle && "max-lg:sr-only",
        className,
      )}
    >
      <p className="hidden min-h-12 items-center gap-2 border-b border-line/80 text-meta text-text-muted [grid-area:context] lg:flex">
        {context.length > 0 ? (
          <span className="flex min-w-0 items-center">
            {context.map((part, i) => (
              <span key={i} className="flex min-w-0 items-center">
                {i > 0 ? <span aria-hidden className="px-1.5">·</span> : null}
                {typeof part === "string" ? <bdi className="truncate">{part}</bdi> : part}
              </span>
            ))}
          </span>
        ) : null}
        <span className="ms-auto shrink-0 tabular" aria-label="امروز">
          {formatJalaliLong()}
        </span>
      </p>
      {backLink ? <BackLink href={backLink.href} label={backLink.label} className="justify-self-start [grid-area:back] lg:mt-4" /> : null}
      <div className={cn("flex min-w-0 items-baseline gap-2 self-center [grid-area:title]", !backLink && "lg:mt-5", hideTitle && "sr-only")}>
        <TitleTag className="min-w-0 text-title font-bold text-text lg:text-display">{title}</TitleTag>
        {count !== undefined ? <span className="tabular shrink-0 text-meta text-text-muted">{count}</span> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 self-center [grid-area:actions] lg:min-h-12 lg:border-b lg:border-line/80 lg:ps-3">
          {actions}
        </div>
      ) : (
        <span className="hidden min-h-12 border-b border-line/80 [grid-area:actions] lg:block" aria-hidden />
      )}
      {description ? <p className="max-w-prose text-sm text-text-muted [grid-area:desc]">{description}</p> : null}
    </header>
    </>
  );
}
