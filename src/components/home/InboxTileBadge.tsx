"use client";

import { CountBadge } from "@/components/CountBadge";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";

/**
 * The unread count on the «پنل من» tile (round 5: the کارتابل is a tile, not a header control). It reads the
 * shell's single summary poller — the same numbers the «امروز» strip shows — so the badge costs no query of its
 * own and moves with the strip. Positioned on the clay mark (`ClayIcon` is `relative`); nothing is drawn at zero.
 */
export function InboxTileBadge() {
  const unread = useInboxSummaryContext().unread;
  // Just inside the mark's top-end corner, so a wide «۹۹+» never reaches into the neighbouring column's gap.
  return <CountBadge count={unread} label={`${formatNumberFa(unread)} مورد خوانده‌نشده`} floating className="-top-1 -end-1" />;
}
