"use client";

import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminResourceMutate } from "@/lib/admin/actions";
import { ResponsiveModal } from "./ResponsiveModal";

/** Archive/delete with an explicit confirm step; the resource decides what "archive" means. `trigger="none"` + `openSignal` let a row's kebab menu open the confirm. */
export function ArchiveButton({ resource, id, labelFa, confirmFa, trigger = "icon", openSignal = 0 }: { resource: string; id: string; labelFa: string; confirmFa: string; trigger?: "icon" | "none"; openSignal?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  // A new signal from the row menu opens the confirm — state adjusted during render (React's "derive from a prop" pattern), no effect.
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    setOpen(true);
  }
  const run = () =>
    start(async () => {
      const r = await adminResourceMutate({ resource, op: "archive", id });
      if (r.ok) {
        toast.success("انجام شد.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <>
      {trigger === "none" ? null : (
        <Button type="button" variant="ghost" size="icon" aria-label={labelFa} onClick={() => setOpen(true)} className="size-11 text-text-muted md:size-9">
          <Archive className="size-4" aria-hidden />
        </Button>
      )}
      <ResponsiveModal open={open} onOpenChange={setOpen} title={labelFa} description={confirmFa}>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            انصراف
          </Button>
          <Button type="button" variant="destructive" className="min-w-28" disabled={pending} onClick={run}>
            {pending ? "…" : labelFa}
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}
