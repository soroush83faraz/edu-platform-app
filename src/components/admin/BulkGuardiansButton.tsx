"use client";

import { UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bulkCreateGuardiansAction } from "@/lib/admin/guardian-actions";
import { formatNumberFa } from "@/lib/format";
import type { BulkGuardiansResult } from "@/modules/iam/guardian";
import { ResponsiveModal } from "./ResponsiveModal";

/** One sentence of what «ساخت حساب اولیا» did — the counts that are not zero, in the order the admin cares about. */
export function bulkGuardiansSummaryFa(r: BulkGuardiansResult): string {
  const n = formatNumberFa;
  const parts: string[] = [];
  if (r.linked > 0) parts.push(`${n(r.linked)} ولی وصل شد`);
  if (r.createdAccounts > 0) parts.push(`${n(r.createdAccounts)} حساب تازه${r.usernameAccounts > 0 ? ` (${n(r.usernameAccounts)} با نام‌کاربری)` : ""}`);
  if (r.staffLinked > 0) parts.push(`${n(r.staffLinked)} به حساب همکار`);
  if (r.reopenedAccounts > 0) parts.push(`${n(r.reopenedAccounts)} حساب دوباره باز شد`);
  if (r.alreadyLinked > 0) parts.push(`${n(r.alreadyLinked)} از قبل وصل بود`);
  if (r.noPhone + r.skippedSelf > 0) parts.push(`${n(r.noPhone + r.skippedSelf)} دانش‌آموز شمارهٴ ولی ندارد`);
  if (r.invalidPhone > 0) parts.push(`${n(r.invalidPhone)} شمارهٴ ولیِ نامعتبر`);
  return parts.length > 0 ? `${parts.join("، ")}.` : "این کلاس دانش‌آموز فعالی ندارد.";
}

/**
 * «ساخت حساب اولیا» of a class (/admin/classes/[id]): confirmed, then for every student with a «ولی» phone the
 * guardian of that phone is found or created and linked (the server's rules; idempotent — a second run changes
 * nothing), and the page opens the class's «برگه‌های ورود اولیا» to print.
 */
export function BulkGuardiansButton({ classGroupId, className }: { classGroupId: string; className: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const run = () =>
    start(async () => {
      const r = await bulkCreateGuardiansAction({ classGroupId });
      setOpen(false);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(bulkGuardiansSummaryFa(r.data));
      router.push(`/admin/classes/${classGroupId}/guardians`);
    });
  return (
    <>
      <Button type="button" variant="outline" className="gap-2" onClick={() => setOpen(true)} disabled={pending}>
        <UsersRound className="size-4" aria-hidden />
        ساخت حساب اولیا
      </Button>
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="ساخت حساب اولیا"
        description={`برای هر دانش‌آموزِ کلاس ${className} که «شمارهٴ ولی» دارد، حساب ولی با همان شماره ساخته می‌شود (اگر آن شماره از قبل حساب ولی یا همکار باشد، همان حساب وصل می‌شود). سپس برگه‌های ورود اولیا برای چاپ باز می‌شود.`}
      >
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            انصراف
          </Button>
          <Button type="button" className="min-w-32" onClick={run} disabled={pending}>
            {pending ? "…" : "ساخت حساب اولیا"}
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}
