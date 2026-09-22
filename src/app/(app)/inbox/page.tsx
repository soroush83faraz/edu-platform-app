import { AlarmClock, CalendarDays, CalendarOff, CalendarRange, CircleCheck, ListTodo, type LucideIcon, Plus, Sun, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { EmptyClay } from "@/components/illustrations";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { BUCKET_LABELS, type Bucket, formatNumberFa } from "@/lib/format";
import { type WorkItemWords, workItemWords } from "@/lib/work-item-words";
import { BUCKETS, INBOX_TABS, type InboxTab } from "@/modules/workspace/dto";
import { listInboxQuery } from "@/modules/workspace/queries";
import type { InboxRow as Row } from "@/modules/workspace/repo";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

export const metadata: Metadata = { title: "پنل من | سامانهٴ مدرسه" };

const TAB_LABELS: Record<InboxTab, string> = { todo: "انجام‌نشده", done: "انجام‌شده", all: "همه" };
const TAB_ICONS: Record<Exclude<InboxTab, "all">, LucideIcon> = { todo: ListTodo, done: CircleCheck };
const VISIBLE_TABS: Exclude<InboxTab, "all">[] = ["todo", "done"];
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
  const { rows, nextCursor, tabCounts, isStaff, canCreate, voice } = result.data;
  // «تکلیف» for a teacher, «تسک» for مدیر/معاون — one noun set for the header, the tabs, the filters, the empties.
  const words = workItemWords(voice);
  const filtered = Boolean(f.bucket || f.unread || f.mine);
  const grouped = groupByBucket(rows, f.tab);

  return (
    <ContentWidth className="gap-3">
      <PageHeader
        title="پنل من"
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/inbox/new">
                <Plus aria-hidden />
                {words.new}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <nav aria-label={`وضعیت ${words.plural}`}>
        <ul className="grid grid-cols-2 gap-1 rounded-2xl bg-neutral-200/60 p-1">
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
                      <span className={cn("tabular rounded-full px-1.5 text-xs leading-5", current ? "bg-info-soft text-primary-800" : "bg-surface/70 text-text-muted")} aria-label={`${formatNumberFa(count)} ${words.singular}`}>
                        {count > 99 ? `${formatNumberFa(99)}+` : formatNumberFa(count)}
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
        <div className="flex flex-wrap items-center gap-2" aria-label="فیلترها">
          {isStaff ? <FilterChip href={href({ ...f, mine: !f.mine, cursor: undefined })} active={f.mine} label={`فقط ${words.given}`} /> : null}
          {f.bucket ? <FilterChip href={href({ ...f, bucket: undefined, cursor: undefined })} active removable label={BUCKET_LABELS[f.bucket]} /> : null}
          {f.unread ? <FilterChip href={href({ ...f, unread: false, cursor: undefined })} active removable label="خوانده‌نشده" /> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Empty tab={f.tab} filtered={filtered} canCreate={canCreate} clearHref={href({ tab: f.tab })} words={words} />
      ) : (
        <div className="mt-2 flex flex-col">
          {grouped.map(([bucket, items]) => (
            <section key={bucket} aria-labelledby={`bucket-${bucket}`}>
              {bucket !== "all" ? (
                <SectionHeader title={BUCKET_LABELS[bucket]} icon={BUCKET_ICONS[bucket]} count={items.length} tone={bucket === "overdue" ? "danger" : "neutral"} />
              ) : (
                <div className="pt-3" />
              )}
              <ul className="reveal-rows surface-work divide-y divide-line/70">
                {items.map((row) => (
                  <InboxRow key={row.id} row={row} words={words} />
                ))}
              </ul>
            </section>
          ))}
          {nextCursor || f.cursor ? (
            <div className="flex items-center justify-center gap-3 py-5">
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
    </ContentWidth>
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

function Empty({ tab, filtered, canCreate, clearHref, words }: { tab: InboxTab; filtered: boolean; canCreate: boolean; clearHref: string; words: WorkItemWords }) {
  if (filtered) {
    return (
      <EmptyState
        illustration={<EmptyClay size={96} />}
        title={`با این فیلتر ${words.indefinite} پیدا نشد`}
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
        title={`${words.indefinite} در انتظار شما نیست`}
description={canCreate ? `وقتی ${words.indefinite} به شما داده شود یا خودتان ${words.indefinite} بدهید، همین‌جا می‌آید.` : `وقتی دبیر یا مدرسه ${words.indefinite} بدهد، همین‌جا می‌آید.`}
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/inbox/new">{words.new}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <EmptyState illustration={<EmptyClay size={96} />} title={`هنوز ${words.indefinite} انجام‌شده علامت نخورده`} description={`${words.plural} تمام‌شده این‌جا نگه داشته می‌شوند.`} />;
}
