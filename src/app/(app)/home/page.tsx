import Link from "next/link";
import { cn } from "cn";
import { Card, CardContent } from "@/components/ui/card";
import { requireContext } from "@/lib/ctx";
import { formatJalaliLong, formatNumberFa } from "@/lib/format";
import { countPersonsInOrg } from "@/modules/iam/queries";
import { inboxSummaryQuery } from "@/modules/workspace/queries";

export default async function HomePage() {
  const ctx = await requireContext(); // the (app) layout already redirected anonymous visitors
  const persons = await countPersonsInOrg(); // FORBIDDEN for roles without org-level person.read → simply hidden
  const summary = await inboxSummaryQuery(); // roles without workspace access simply get no strip

  return (
    <div className="flex flex-col gap-5 p-4 md:pt-8">
      <section className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-text">
          سلام، <bdi>{ctx.firstName}</bdi>
        </h2>
        <p className="text-text-muted">{formatJalaliLong()}</p>
        <p className="text-sm text-text-muted">
          {ctx.orgName}
          {ctx.schoolName ? ` · ${ctx.schoolName}` : ""}
        </p>
      </section>

      {summary.ok ? (
        <section aria-labelledby="today-heading" className="flex flex-col gap-2">
          <h3 id="today-heading" className="text-sm font-semibold text-text-muted">
            امروز
          </h3>
          <ul className="grid grid-cols-3 gap-2">
            <TodayTile href="/inbox?bucket=overdue" label="سررسیده" value={summary.data.overdue} tone="danger" />
            <TodayTile href="/inbox?bucket=today" label="امروز" value={summary.data.dueToday} tone="primary" />
            <TodayTile href="/inbox?unread=1" label="خوانده‌نشده" value={summary.data.unread} tone="neutral" />
          </ul>
          {summary.data.overdue + summary.data.dueToday + summary.data.unread === 0 ? <p className="text-sm text-text-faint">چیزی برای امروز نمانده.</p> : null}
        </section>
      ) : null}

      {persons.ok ? (
        <Card>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-sm text-text-muted">افراد ثبت‌شده در سازمان</span>
            <span className="tabular text-2xl font-bold">{formatNumberFa(persons.data)}</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** A count that is also the way in: tap → the inbox pre-filtered to exactly those items. */
function TodayTile({ href, label, value, tone }: { href: string; label: string; value: number; tone: "danger" | "primary" | "neutral" }) {
  const zero = value === 0;
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex min-h-20 flex-col justify-between rounded-card border bg-surface p-3 transition-colors hover:bg-surface-sunken",
          !zero && tone === "danger" ? "border-danger/40" : "border-line",
        )}
      >
        <span className={cn("tabular text-2xl font-bold leading-none", zero ? "text-text-faint" : tone === "danger" ? "text-danger" : tone === "primary" ? "text-primary-600" : "text-text")}>
          {formatNumberFa(value)}
        </span>
        <span className="text-sm text-text-muted">{label}</span>
      </Link>
    </li>
  );
}
