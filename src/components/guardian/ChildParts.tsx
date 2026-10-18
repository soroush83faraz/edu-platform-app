// The shared parts of the guardian's pages (`/child/*`, owner 2026-10-18): the page header that names the child and
// leads back to Home with that child selected, and the compact switcher between children (only when there are
// several). Server components; every link is a plain `?child=` the server validates again on arrival.
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/cn";
import { childHref, homeChildHref, type ChildPage } from "@/modules/iam/guardian-policy";
import type { GuardianChild } from "@/modules/iam/guardian-queries";

/** «<نام> · کلاس <کلاس>» under the page title; back = Home with this child selected. */
export async function ChildPageHeader({ title, child, extra }: { title: string; child: GuardianChild; extra?: React.ReactNode }) {
  return (
    <PageHeader
      title={title}
      description={
        <>
          <bdi>
            {child.firstName} {child.lastName}
          </bdi>
          {child.className ? (
            <>
              {" · "}کلاس <bdi>{child.className}</bdi>
            </>
          ) : null}
          {extra ? <> · {extra}</> : null}
        </>
      }
      back={{ href: homeChildHref(child.studentProfileId), label: "خانه" }}
    />
  );
}

/**
 * The child switcher of a child page: one 44 px pill per child (first name + class), the current one marked — the same
 * page for another child. Nothing for a single child.
 */
export function ChildSwitcher({ items, current, page }: { items: readonly GuardianChild[]; current: string; page: ChildPage }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="فرزند" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {items.map((c) => {
        const on = c.studentProfileId === current;
        return (
          <Link
            key={c.studentProfileId}
            prefetch={false}
            href={childHref(page, c.studentProfileId)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm",
              on ? "border-primary-200 bg-primary-50 font-semibold text-primary-800" : "border-line bg-surface text-text-muted hover:text-text",
            )}
          >
            <bdi>{c.firstName}</bdi>
            {c.className ? (
              <span className="text-meta">
                · <bdi>{c.className}</bdi>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
