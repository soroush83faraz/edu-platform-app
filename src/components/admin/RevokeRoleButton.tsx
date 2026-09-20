"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revokeRoleAction } from "@/lib/admin/people-actions";
import { ResponsiveModal } from "./ResponsiveModal";

export function RevokeRoleButton({ roleAssignmentId }: { roleAssignmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await revokeRoleAction({ roleAssignmentId });
      setOpen(false);
      if (r.ok) {
        toast.success("نقش لغو شد.");
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-9 text-danger" onClick={() => setOpen(true)}>
        لغو
      </Button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="لغو نقش" description="این نقش از فرد گرفته می‌شود و دسترسی‌های آن از همین لحظه قطع می‌شود.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
            انصراف
          </Button>
          <Button type="button" variant="destructive" className="h-11 min-w-28" disabled={pending} onClick={run}>
            لغو نقش
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}
