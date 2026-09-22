import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { formatJalaliLong } from "@/lib/format";
import { getShellContext } from "@/lib/shell-context";

/**
 * The header of every page, one DOM in two shapes. On phones: an optional back link, the title (`text-title`)
 * with the actions at its end, then the description. From `lg:` the same nodes settle into a slim header bar —
 * the context line «مدرسه · سال · نوبت» at the start, today's Jalali date and the page's primary action at the
 * end, a hairline under it — with the title (`text-display`) and description beneath. The action node moves
 * between the two rows through `grid-area`, so nothing is rendered twice and nothing is portalled after hydration.
 * `count` sits beside the title as a quiet tabular number (list pages). Context is read once per request.
 */
export async function PageHeader({
  title,
  description,
  count,
  back,
  actions,
  className,
  titleAs: TitleTag = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  count?: number | string;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  className?: string;
  titleAs?: "h1" | "h2";
}) {
  const shell = await getShellContext();
  const context = [shell.schoolName, shell.yearName, shell.termName].filter(Boolean);
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 pt-4",
        "[grid-template-areas:'back_back'_'title_actions'_'desc_desc']",
        "lg:pt-0 lg:[grid-template-areas:'context_actions'_'back_back'_'title_title'_'desc_desc']",
        className,
      )}
    >
      <p className="hidden min-h-12 items-center gap-2 border-b border-line/80 text-meta text-text-muted [grid-area:context] lg:flex">
        {context.length > 0 ? (
          <span className="truncate">
            {context.map((part, i) => (
              <span key={i}>
                {i > 0 ? <span aria-hidden> · </span> : null}
                <bdi>{part}</bdi>
              </span>
            ))}
          </span>
        ) : null}
        <span className="ms-auto shrink-0 tabular" aria-label="امروز">
          {formatJalaliLong()}
        </span>
      </p>
      {back ? (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted [grid-area:back] hover:text-text lg:mt-4 lg:min-h-9">
          <ArrowRight className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className={cn("flex min-w-0 items-baseline gap-2 self-center [grid-area:title]", !back && "lg:mt-5")}>
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
