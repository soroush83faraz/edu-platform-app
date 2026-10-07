import { Plus, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { type Audience, audienceOf, emptyOpenCopy } from "@/lib/empty-copy";
import { requireContext } from "@/lib/ctx";
import { BUCKET_LABELS, type Bucket, formatNumberFa } from "@/lib/format";
import { getTeacherHues } from "@/lib/teacher-hues";
import { type WorkItemWords, workItemWords } from "@/lib/work-item-words";
import { BUCKETS } from "@/modules/workspace/dto";
import { listWorkItemsQuery } from "@/modules/workspace/queries";
import { WorkItemList } from "@/modules/workspace/ui/WorkItemList";

export const metadata: Metadata = { title: "پنل من" };

type Search = Record<string, string | string[] | undefined>;

interface Filters {
  bucket?: Bucket;
  mine: boolean;
  unread: boolean;
  cursor?: string;
  /** «نمایش همه» of the finished tail (the latest 20 otherwise). */
  allDone: boolean;
}

// No tabs any more (owner, mock class-page-v3): an old `?tab=done` / `?tab=all` link is simply ignored — the one
// list already holds the finished items at its bottom.
function readFilters(sp: Search): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const bucket = one("bucket");
  return {
    bucket: (BUCKETS as readonly string[]).includes(bucket ?? "") ? (bucket as Bucket) : undefined,
    mine: one("mine") === "1",
    unread: one("unread") === "1",
    cursor: one("cursor") || undefined,
    allDone: one("done") === "all",
  };
}

function href(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  if (f.bucket) p.set("bucket", f.bucket);
  if (f.mine) p.set("mine", "1");
  if (f.unread) p.set("unread", "1");
  if (f.cursor) p.set("cursor", f.cursor);
  if (f.allDone) p.set("done", "all");
  const q = p.toString();
  return q ? `/inbox?${q}` : "/inbox";
}

/**
 * «پنل من»: ONE list (owner, mock class-page-v3, 2026-10-07 — it replaced the «انجام‌نشده» / «انجام‌شده» tabs and the
 * deadline-bucket boxes): every open item, overdue first then by deadline, each with its status tag at the end; then
 * «انجام‌شده‌ها» with the latest finished ones. Each row leads with its مُهر درس (a personal note / an admin task with
 * its quiet type glyph) and names its درس in the meta line. The filters that are features stay as chips:
 * «فقط تکالیف داده‌شده» for staff, and the removable deadline / unread filters Home and the notifications link to.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const f = readFilters(await searchParams);
  const result = await listWorkItemsQuery({ bucket: f.bucket, createdByMe: f.mine, unreadOnly: f.unread, cursor: f.cursor, allDone: f.allDone });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="پنل من در دسترس نیست" description={result.message} />;
  }
  const { open, done, nextCursor, counts, isStaff, canCreate, voice, createVoice } = result.data;
  // «تکلیف» for a teacher, «تسک» for مدیر/معاون — one noun set for the header, the filters, the empties.
  const words = workItemWords(voice);
  // What THIS person opens, which differs only for a student: the تکالیف in the list keep their name while
  // the button above them says «تسک جدید» (src/lib/work-item-words, round 6).
  const createWords = workItemWords(createVoice);
  const filtered = Boolean(f.bucket || f.unread || f.mine);
  // A teacher's rows wear the colour of their class (owner 2026-10-06); everyone else's the درس's.
  const hues = await getTeacherHues();
  const audience = audienceOf((await requireContext()).assignments);
  const summary = [counts.todo > 0 ? `${formatNumberFa(counts.todo)} در انتظار` : null, counts.done > 0 ? `${formatNumberFa(counts.done)} انجام‌شده` : null]
    .filter(Boolean)
    .join(" · ");
  const moreDone = !f.bucket && !f.allDone && !nextCursor && counts.done > done.length;

  return (
    <ContentWidth className="gap-3">
      <PageHeader
        // No nav cell leads here any more (nav round 2026-09-27): the page is opened from Home's card, so it
        // goes back there like any inner page.
        back={{ href: "/home", label: "خانه" }}
        title="پنل من"
        description={summary || undefined}
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

      {isStaff || filtered ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="فیلترها">
          {isStaff ? <FilterChip href={href({ ...f, mine: !f.mine, cursor: undefined })} active={f.mine} label={`فقط ${words.given}`} /> : null}
          {f.bucket ? <FilterChip href={href({ ...f, bucket: undefined, cursor: undefined })} active removable label={BUCKET_LABELS[f.bucket]} /> : null}
          {f.unread ? <FilterChip href={href({ ...f, unread: false, cursor: undefined })} active removable label="خوانده‌نشده" /> : null}
        </div>
      ) : null}

      {open.length === 0 && done.length === 0 ? (
        <Empty filtered={filtered} canCreate={canCreate} clearHref="/inbox" words={words} createWords={createWords} audience={audience} firstTime={counts.done === 0} />
      ) : (
        <div className="mt-1 flex flex-col">
          {/* The line in place of the open rows when only finished ones are left. */}
          <WorkItemList open={open} done={done} openEmpty={emptyOpenCopy(audience, false).title} rowProps={{ words, createVoice, hues }} />
          {nextCursor || f.cursor || moreDone ? (
            <div className="flex flex-wrap items-center justify-center gap-3 py-5">
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
              {moreDone ? (
                <Button asChild variant="outline">
                  <Link href={href({ ...f, allDone: true })}>نمایش همهٴ انجام‌شده‌ها</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </ContentWidth>
  );
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
  filtered,
  canCreate,
  clearHref,
  words,
  createWords,
  audience,
  firstTime,
}: {
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
