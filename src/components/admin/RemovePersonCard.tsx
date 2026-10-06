"use client";

import { UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removePersonAction } from "@/lib/admin/people-actions";
import { ResponsiveModal } from "./ResponsiveModal";

export type RemovalKind = "student" | "staff";

export interface RemovalCopy {
  /** The button and the confirm's title. */
  label: string;
  /** One line beside the button: what a removal does. */
  summary: string;
  /** The confirm's question — names the person, says what goes and what stays. */
  confirm: string;
  /** Where the page goes once the person is removed. */
  listHref: string;
  done: string;
}

/** The words of «حذف دانش‌آموز» / «حذف از کارکنان» (src/modules/iam/removal.ts is what they promise). */
export function removalCopy(kind: RemovalKind, name: string): RemovalCopy {
  if (kind === "student") {
    return {
      label: "حذف دانش‌آموز",
      summary: "از فهرست دانش‌آموزان و کلاسش برداشته می‌شود و دیگر نمی‌تواند وارد شود؛ سوابق تکالیف و حضور و غیاب می‌ماند.",
      confirm: `${name} از فهرست‌ها و کلاسش برداشته می‌شود و دیگر نمی‌تواند وارد سامانه شود. سوابق تکالیف و حضور و غیاب او می‌ماند. این کار از این‌جا برگشت ندارد.`,
      listHref: "/admin/students",
      done: `${name} حذف شد.`,
    };
  }
  return {
    label: "حذف از کارکنان",
    summary: "از فهرست کارکنان و کلاس‌هایش برداشته می‌شود، تدریس و نقش‌هایش پایان می‌یابد و دیگر نمی‌تواند وارد شود؛ سوابق تکالیف و حضور و غیاب می‌ماند.",
    confirm: `${name} از فهرست کارکنان و کلاس‌هایی که در آن‌ها تدریس می‌کند برداشته می‌شود، نقش‌هایش پایان می‌یابد و دیگر نمی‌تواند وارد سامانه شود. سوابق تکالیف و حضور و غیاب او می‌ماند. این کار از این‌جا برگشت ندارد.`,
    listHref: "/admin/staff",
    done: `${name} از کارکنان حذف شد.`,
  };
}

/**
 * The person page's last, separated block: «حذف دانش‌آموز» / «حذف از کارکنان» behind a confirm that names the person
 * and says what happens. Rendered only when the server said the removal would be accepted (`personDetailQuery`
 * `removable`); the action re-checks everything. On success: a toast, then the list the person just left.
 */
export function RemovePersonCard({ personId, name, kind }: { personId: string; name: string; kind: RemovalKind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const copy = removalCopy(kind, name);
  const remove = () =>
    start(async () => {
      const r = await removePersonAction({ personId, kind });
      if (r.ok) {
        setOpen(false);
        toast.success(r.data.alreadyRemoved ? `${name} پیش‌تر حذف شده بود.` : copy.done);
        // The refresh queues behind the navigation and re-renders the admin frame on the list, so the section
        // counts lose the person too (a navigation alone keeps the shared layout as it was rendered).
        router.replace(copy.listHref);
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <section aria-labelledby="remove-heading" className="flex flex-col gap-3 surface-panel p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id="remove-heading" className="text-sm font-semibold text-text">
          {copy.label}
        </h3>
        <p className="text-meta text-text-muted">{copy.summary}</p>
      </div>
      <Button type="button" variant="destructive" className="shrink-0 gap-2 self-start sm:self-center" onClick={() => setOpen(true)} disabled={pending}>
        <UserX className="size-4" aria-hidden />
        {copy.label}
      </Button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title={copy.label} description={copy.confirm}>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            انصراف
          </Button>
          <Button type="button" variant="destructive" className="min-w-28 gap-2" disabled={pending} onClick={remove}>
            <UserX className="size-4" aria-hidden />
            {pending ? "…" : copy.label}
          </Button>
        </div>
      </ResponsiveModal>
    </section>
  );
}
