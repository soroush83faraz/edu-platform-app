import { AlarmClock, CalendarDays, CalendarOff, CalendarRange, CircleCheck, ListTodo, type LucideIcon, Plus, Sun, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { CrossFade } from "@/components/motion/CrossFade";
import { LeavingList } from "@/components/motion/LeavingList";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentedLinks } from "@/components/SegmentedLinks";
import { Button } from "@/components/ui/button";
import { type Audience, audienceOf, emptyDoneCopy, emptyOpenCopy } from "@/lib/empty-copy";
import { requireContext } from "@/lib/ctx";
import { BUCKET_LABELS, type Bucket, formatNumberFa } from "@/lib/format";
import { type WorkItemWords, workItemWords } from "@/lib/work-item-words";
import { BUCKETS, INBOX_TABS, type InboxTab } from "@/modules/workspace/dto";
import { listInboxQuery } from "@/modules/workspace/queries";
import type { InboxRow as Row } from "@/modules/workspace/repo";
import { InboxRow } from "@/modules/workspace/ui/InboxRow";

export const metadata: Metadata = { title: "پنل من" };

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
  const { rows, nextCursor, tabCounts, isStaff, canCreate, voice, createVoice } = result.data;
  // «تکلیف» for a teacher, «تسک» for مدیر/معاون — one noun set for the header, the tabs, the filters, the empties.
  const words = workItemWords(voice);
  // What THIS person opens, which differs only for a student: the تکالیف in the list keep their name while
  // the button above them says «تسک جدید» (src/lib/work-item-words, round 6).
  const createWords = workItemWords(createVoice);
  const filtered = Boolean(f.bucket || f.unread || f.mine);
  const grouped = groupByBucket(rows, f.tab);

  return (
    <ContentWidth className="gap-3">
      <PageHeader
        // No nav cell leads here any more (nav round 2026-09-27): the page is opened from Home's card, so it
        // goes back there like any inner page.
        back={{ href: "/home", label: "خانه" }}
        title="پنل من"
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/inbox/new">
                <Plus aria-hidden />
                {createWords.new}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <SegmentedLinks
        label={`وضعیت ${words.plural}`}
        current={f.tab}
        items={VISIBLE_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const count = tabCounts[tab];
          return {
            key: tab,
            href: href({ ...f, tab, cursor: undefined }),
            label: TAB_LABELS[tab],
            icon: <Icon className="size-4" strokeWidth={1.75} aria-hidden />,
            count: { value: count, text: count > 99 ? `${formatNumberFa(99)}+` : formatNumberFa(count), label: `${formatNumberFa(count)} ${words.singular}` },
          };
        })}
      />

      {/* The list of the chosen tab fades in over the one it replaces (180 ms) — never on a page view. */}
      <CrossFade swapKey={f.tab} className="flex flex-col gap-3">
        {isStaff || filtered ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="فیلترها">
            {isStaff ? <FilterChip href={href({ ...f, mine: !f.mine, cursor: undefined })} active={f.mine} label={`فقط ${words.given}`} /> : null}
            {f.bucket ? <FilterChip href={href({ ...f, bucket: undefined, cursor: undefined })} active removable label={BUCKET_LABELS[f.bucket]} /> : null}
            {f.unread ? <FilterChip href={href({ ...f, unread: false, cursor: undefined })} active removable label="خوانده‌نشده" /> : null}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <Empty tab={f.tab} filtered={filtered} canCreate={canCreate} clearHref={href({ tab: f.tab })} words={words} createWords={createWords} audience={audienceOf((await requireContext()).assignments)} firstTime={tabCounts.done === 0} />
        ) : (
          <div className="mt-2 flex flex-col">
            {grouped.map(([bucket, items]) => (
              <section key={bucket} aria-labelledby={`bucket-${bucket}`}>
                {bucket !== "all" ? (
                  <SectionHeader title={BUCKET_LABELS[bucket]} icon={BUCKET_ICONS[bucket]} count={items.length} tone={bucket === "overdue" ? "danger" : "neutral"} />
                ) : (
                  <div className="pt-3" />
                )}
                {/* Rows leave by collapsing, not popping; a row the detail page just finished is handed over. */}
                <LeavingList className="reveal-rows surface-work divide-y divide-line/70" completedFrom={f.tab === "todo"}>
                  {items.map((row) => (
                    <InboxRow key={row.id} row={row} words={words} createVoice={createVoice} />
                  ))}
                </LeavingList>
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
      </CrossFade>
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

function Empty({
  tab,
  filtered,
  canCreate,
  clearHref,
  words,
  createWords,
  audience,
  firstTime,
}: {
  tab: InboxTab;
  filtered: boolean;
  canCreate: boolean;
  clearHref: string;
  words: WorkItemWords;
  createWords: WorkItemWords;
  /** Who reads it: a student is spoken to as «تو», staff as «شما» (`src/lib/empty-copy.ts`). */
  audience: Audience;
  /** Nothing finished either — a دبیر reads «هنوز تکلیفی نداده‌اید». */
  firstTime: boolean;
}) {
  // Text only: the clay illustrations stay on login and the «امروز کلاس نداری» spot (UX review 2026-09-27).
  if (filtered) {
    return (
      <EmptyState
        title={`با این فیلتر ${words.indefinite} پیدا نشد.`}
        action={
          <Button asChild variant="outline">
            <Link href={clearHref}>حذف فیلتر</Link>
          </Button>
        }
      />
    );
  }
  if (tab === "todo") {
    const copy = emptyOpenCopy(audience, canCreate, firstTime);
    return (
      <EmptyState
        title={copy.title}
        description={copy.description}
        action={
          canCreate ? (
            <Button asChild variant="outline">
              <Link href="/inbox/new">{createWords.new}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  const copy = emptyDoneCopy(audience);
  return <EmptyState title={copy.title} description={copy.description} />;
}
