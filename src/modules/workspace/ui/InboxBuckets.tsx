import { AlarmClock, CalendarDays, CalendarOff, CalendarRange, type LucideIcon, Sun } from "lucide-react";
import { LeavingList } from "@/components/motion/LeavingList";
import { SectionHeader } from "@/components/SectionHeader";
import { BUCKET_LABELS, type Bucket } from "@/lib/format";
import type { OfferingHues } from "@/lib/subject-stamp";
import type { WorkItemVoice, WorkItemWords } from "@/lib/work-item-words";
import type { InboxRow as Row } from "../repo";
import { InboxBoxRow } from "./InboxRow";

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "week", "later", "none"];
const BUCKET_ICONS: Record<Bucket, LucideIcon> = { overdue: AlarmClock, today: Sun, week: CalendarDays, later: CalendarRange, none: CalendarOff };

/** The open rows by deadline bucket, in the bucket order; an empty bucket is absent. */
export function groupByBucket(rows: Row[]): [Bucket, Row[]][] {
  const map = new Map<Bucket, Row[]>();
  for (const r of rows) map.set(r.bucket, [...(map.get(r.bucket) ?? []), r]);
  return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!]);
}

/**
 * «انجام‌نشده» of «پنل من» as a board (owner, 2026-09-27): each deadline bucket — «سررسیده», «امروز», «این هفته»,
 * «بعداً», «بدون مهلت» — is its own box (`surface-work`, the bucket's name and count on top, its compact rows
 * inside), and the boxes sit in a two-column grid on every width, so four buckets read as 2×2. Normal grid flow: an
 * odd last box keeps its one cell. Boxes align to their top (a short box does not stretch to its neighbour).
 * «سررسیده» differs only by its red name and count. Rows still leave by folding (`LeavingList`). `hues`: the
 * reader's own colour per class they teach (`InboxRow`).
 */
export function InboxBuckets({ rows, words, createVoice, hues }: { rows: Row[]; words: WorkItemWords; createVoice: WorkItemVoice; hues?: OfferingHues }) {
  const groups = groupByBucket(rows);
  return (
    <div className="grid grid-cols-2 items-start gap-3" data-slot="bucket-grid">
      {groups.map(([bucket, items]) => (
        <section key={bucket} aria-label={BUCKET_LABELS[bucket]} data-bucket={bucket} className="surface-work min-w-0 overflow-hidden">
          <SectionHeader
            title={BUCKET_LABELS[bucket]}
            icon={BUCKET_ICONS[bucket]}
            count={items.length}
            tone={bucket === "overdue" ? "danger" : "neutral"}
            className="px-3 pt-3 pb-1"
          />
          {/* Rows leave by collapsing, not popping; a row the detail page just finished is handed over. */}
          <LeavingList className="reveal-rows divide-y divide-line/70" completedFrom>
            {items.map((row) => (
              <InboxBoxRow key={row.id} row={row} words={words} createVoice={createVoice} hues={hues} />
            ))}
          </LeavingList>
        </section>
      ))}
    </div>
  );
}
