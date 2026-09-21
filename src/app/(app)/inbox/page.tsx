import { AlarmClock, CalendarDays, CalendarOff, CalendarRange, CircleCheck, ListTodo, type LucideIcon, Play, Plus, Sun, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { EmptyClay } from "@/components/illustrations";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { BUCKET_LABELS, type Bucket, formatNumberFa } from "@/lib/format";
import { BUCKETS, INBOX_TABS, type InboxTab } from "@/modules/workspace/dto";
import { listInboxQuery } from "@/modules/workspace/queries";
import type { InboxRow as Row } from "@/modules/workspace/repo";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

export const metadata: Metadata = { title: "پنل من | سامانهٴ مدرسه" };

const TAB_LABELS: Record<InboxTab, string> = { todo: "انجام‌نشده", doing: "در جریان", done: "انجام‌شده", all: "همه" };
const TAB_ICONS: Record<Exclude<InboxTab, "all">, LucideIcon> = { todo: ListTodo, doing: Play, done: CircleCheck };
const VISIBLE_TABS: Exclude<InboxTab, "all">[] = ["todo", "doing", "done"];
const BUCKET_ORDER: Bucket[] = ["overdue", "today", "week", "later", "none"];
const BUCKET_ICONS: Record<Bucket, LucideIcon> = { overdue: AlarmClock, today: Sun, week: CalendarDays, later: CalendarRange, none: CalendarOff };

type Search = Record<string, string | string[] | undefined>;

interface Filters {
  tab: InboxTab;
  bucket?: Bucket;
  mine: boolean;
  unread: boolean;
  cursor?: string;
}

function readFilters(sp: Search): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const tab = one("tab");
  const bucket = one("bucket");
  return {
    tab: (INBOX_TABS as readonly string[]).includes(tab ?? "") ? (tab as InboxTab) : "todo",
    bucket: (BUCKETS as readonly string[]).includes(bucket ?? "") ? (bucket as Bucket) : undefined,
    mine: one("mine") === "1",
    unread: one("unread") === "1",
    cursor: one("cursor") || undefined,
  };
}

function href(f: Partial<Filters> & { tab: InboxTab }): string {
  const p = new URLSearchParams();
  if (f.tab !== "todo") p.set("tab", f.tab);
  if (f.bucket) p.set("bucket", f.bucket);
  if (f.mine) p.set("mine", "1");
  if (f.unread) p.set("unread", "1");
  if (f.cursor) p.set("cursor", f.cursor);
  const q = p.toString();
  return q ? `/inbox?${q}` : "/inbox";
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const f = readFilters(await searchParams);
  const result = await listInboxQuery({ tab: f.tab, bucket: f.bucket, createdByMe: f.mine, unreadOnly: f.unread, cursor: f.cursor });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="پنل من در دسترس نیست" description={result.message} />;
  }
  const { rows, nextCursor, tabCounts, isStaff, canCreate } = result.data;
  const filtered = Boolean(f.bucket || f.unread || f.mine);
  const grouped = groupByBucket(rows, f.tab);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-3 md:pt-8">
        <h2 className="text-xl font-bold text-text">پنل من</h2>
        {canCreate ? (
          <Button asChild>
            <Link href="/inbox/new">
              <Plus aria-hidden />
              کار جدید
            </Link>
          </Button>
        ) : null}
      </div>

      <nav aria-label="وضعیت کارها" className="px-4">
        <ul className="grid grid-cols-3 gap-1 rounded-2xl bg-neutral-200/60 p-1">
          {VISIBLE_TABS.map((tab) => {
            const current = f.tab === tab;
            const Icon = TAB_ICONS[tab];
            const count = tabCounts[tab];
            return (
              <li key={tab}>
                <Link
                  href={href({ ...f, tab, cursor: undefined })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "pressable flex h-14 flex-col items-center justify-center gap-0 rounded-xl px-1 text-sm sm:h-11 sm:flex-row sm:gap-1.5",
                    current ? "bg-surface font-semibold text-primary-800 shadow-1" : "text-text-muted hover:text-text",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", current ? "text-primary-600" : "text-text-faint")} strokeWidth={1.75} aria-hidden />
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{TAB_LABELS[tab]}</span>
                    {count > 0 ? (
                      <span className={cn("tabular rounded-full px-1.5 text-xs leading-5", current ? "bg-info-soft text-primary-800" : "bg-surface/70 text-text-muted")} aria-label={`${formatNumberFa(count)} کار`}>
                        {formatNumberFa(count > 99 ? 99 : count)}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {isStaff || filtered ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3" aria-label="فیلترها">
          {isStaff ? <FilterChip href={href({ ...f, mine: !f.mine, cursor: undefined })} active={f.mine} label="فقط کارهایی که دادم" /> : null}
          {f.bucket ? <FilterChip href={href({ ...f, bucket: undefined, cursor: undefined })} active removable label={BUCKET_LABELS[f.bucket]} /> : null}
          {f.unread ? <FilterChip href={href({ ...f, unread: false, cursor: undefined })} active removable label="خوانده‌نشده" /> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Empty tab={f.tab} filtered={filtered} canCreate={canCreate} clearHref={href({ tab: f.tab })} />
      ) : (
        <div className="mt-2 flex flex-col">
          {grouped.map(([bucket, items]) => (
            <section key={bucket} aria-labelledby={`bucket-${bucket}`}>
              {bucket !== "all" ? (
                <SectionHeader title={BUCKET_LABELS[bucket]} icon={BUCKET_ICONS[bucket]} count={items.length} tone={bucket === "overdue" ? "danger" : "neutral"} />
              ) : (
                <div className="pt-3" />
              )}
              <ul className="reveal-rows mx-4 divide-y divide-line/70 rounded-card bg-surface shadow-1">
                {items.map((row) => (
                  <InboxRow key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ))}
          {nextCursor || f.cursor ? (
            <div className="flex items-center justify-center gap-3 px-4 py-5">
              {f.cursor ? (
                <Button asChild variant="ghost">
                  <Link href={href({ ...f, cursor: undefined })}>بازگشت به ابتدا</Link>
                </Button>
              ) : null}
              {nextCursor ? (
                <Button asChild variant="outline">
                  <Link href={href({ ...f, cursor: nextCursor })}>نمایش بیشتر</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}

function groupByBucket(rows: Row[], tab: InboxTab): [Bucket | "all", Row[]][] {
  if (tab === "done") return rows.length ? [["all", rows]] : [];
  const map = new Map<Bucket, Row[]>();
  for (const r of rows) map.set(r.bucket, [...(map.get(r.bucket) ?? []), r]);
  return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!]);
}

function FilterChip({ href, active, label, removable }: { href: string; active: boolean; label: string; removable?: boolean }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "pressable inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm",
        active ? "border-info bg-info-soft text-primary-800" : "border-line bg-surface text-text-muted hover:border-line-strong",
      )}
    >
      {label}
      {removable ? <X className="size-3.5" aria-label="حذف فیلتر" /> : null}
    </Link>
  );
}

function Empty({ tab, filtered, canCreate, clearHref }: { tab: InboxTab; filtered: boolean; canCreate: boolean; clearHref: string }) {
  if (filtered) {
    return (
      <EmptyState
        illustration={<EmptyClay size={96} />}
        title="با این فیلتر کاری پیدا نشد"
        action={
          <Button asChild variant="outline">
            <Link href={clearHref}>حذف فیلتر</Link>
          </Button>
        }
      />
    );
  }
  if (tab === "todo") {
    return (
      <EmptyState
        illustration={<EmptyClay size={128} />}
        title="کاری در انتظار شما نیست"
        description={canCreate ? "وقتی کاری به شما سپرده شود یا خودتان کاری بسازید، همین‌جا می‌آید." : "وقتی کاری به شما سپرده شود، همین‌جا می‌آید."}
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/inbox/new">کار جدید</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (tab === "doing") {
    return (
      <EmptyState
        illustration={<EmptyClay size={96} />}
        title="هیچ کاری در جریان نیست"
        description="کاری را با «شروع کردم» به این فهرست بیاورید."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/inbox">کارهای انجام‌نشده</Link>
          </Button>
        }
      />
    );
  }
  return <EmptyState illustration={<EmptyClay size={96} />} title="هنوز کاری انجام‌شده علامت نخورده" description="کارهای تمام‌شده این‌جا نگه داشته می‌شوند." />;
}
