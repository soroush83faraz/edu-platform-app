import { BackLink } from "@/components/layout/BackLink";
import { cn } from "@/lib/cn";
import { formatJalaliLong } from "@/lib/format";
import { SchoolsMenu } from "@/components/layout/SchoolsMenu";
import { getShellContext } from "@/lib/shell-context";
import { getUiVariant } from "@/lib/ui-variant";

/**
 * The header of every page, one DOM in two shapes. On phones: an optional back link, the title (`text-title`)
 * with the actions at its end, then the description. From `lg:` the same nodes settle into a slim header bar —
 * the context line «مدرسه · سال · نوبت» at the start, today's Jalali date and the page's primary action at the
 * end, a hairline under it — with the title (`text-display`) and description beneath. The action node moves
 * between the two rows through `grid-area`, so nothing is rendered twice and nothing is portalled after hydration.
 * `count` sits beside the title as a quiet tabular number (list pages). Context is read once per request.
 * `hideTitle` keeps the title for assistive tech only: on phones the whole header is then visually gone (a page
 * the bottom nav already names, e.g. «کلاس من»), from `lg:` only the context bar shows.
 * In the experimental «hub» layout (no bottom nav or rail — docs/decisions-pending/home-hub.md) every page must lead
 * back to Home: with no `back` given, the header draws a «خانه» back link to /home (and a `hideTitle` header stays
 * visible on phones so that link shows). `back={false}` opts out — Home itself. In «classic» `false` = no link.
 */
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
  const hubHome = back === undefined && (await getUiVariant()) === "hub";
  const backLink = back || (hubHome ? { href: "/home", label: "خانه" } : undefined);
  // More than one school in the caller's scope: the chip replaces the name and opens the list (`SchoolsMenu`).
  const context: React.ReactNode[] = [shell.schools.length > 1 ? <SchoolsMenu key="schools" schools={shell.schools} /> : shell.schoolName, shell.yearName, shell.termName].filter(Boolean);
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 pt-4",
        "[grid-template-areas:'back_back'_'title_actions'_'desc_desc']",
        "lg:pt-0 lg:[grid-template-areas:'context_actions'_'back_back'_'title_title'_'desc_desc']",
        hideTitle && !hubHome && "max-lg:sr-only",
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
  );
}
