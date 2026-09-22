"use client";

import { Archive, Ban, Check, Ellipsis, Pin, PinOff, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { archiveInboxAction, changeStatusAction, markInboxReadAction, setPinnedAction } from "../actions";
import type { StatusCategory } from "../repo";

export interface WorkItemActionsProps {
  workItemId: string;
  statusCategory: StatusCategory;
  myAssigneeState: "pending" | "accepted" | "done" | null;
  isManager: boolean;
  canUpdate: boolean;
  inbox: { state: string; isPinned: boolean } | null;
}

/** Status buttons per role + the «گزینه‌های بیشتر» menu (pin / archive). Marks my inbox row read once on mount. */
export function WorkItemActions({ workItemId, statusCategory, myAssigneeState, isManager, canUpdate, inbox }: WorkItemActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pinned, setPinned] = useState(inbox?.isPinned ?? false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (inbox?.state !== "unread") return;
    void markInboxReadAction({ workItemId }).then((r) => {
      if (r.ok && r.data.changed) router.refresh();
    });
  }, [inbox?.state, workItemId, router]);

  const run = (label: string, fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(label);
        router.refresh();
      } else toast.error(r.message ?? "خطایی رخ داد.");
    });

  const closed = statusCategory === "done" || statusCategory === "cancelled";
  const isAssignee = myAssigneeState !== null;
  const buttons: React.ReactNode[] = [];

  // «شروع کردم» (in_progress) is hidden with the «در جریان» tab (owner decision); the status machine and the
  // `changeStatus` transition stay intact — only «انجام شد» is offered to an assignee.
  if (canUpdate && isAssignee && !closed) {
    if (myAssigneeState !== "done") {
      buttons.push(
        <Button key="done" size="lg" className="w-full" disabled={pending} onClick={() => run("انجام شد", () => changeStatusAction({ workItemId, toStatusCode: "done" }))}>
          <Check aria-hidden />
          انجام شد
        </Button>,
      );
    }
  }
  if (canUpdate && isManager) {
    if (closed) {
      buttons.push(
        <Button key="reopen" variant="outline" size="lg" className="w-full" disabled={pending} onClick={() => run("بازگشایی شد", () => changeStatusAction({ workItemId, toStatusCode: "open" }))}>
          <RotateCcw aria-hidden />
          بازگشایی
        </Button>,
      );
    } else {
      // Cancelling closes the item for every assignee — one confirm step (the same modal the admin archive uses).
      buttons.push(
        <Button key="cancel" variant="ghost" size="lg" className="w-full text-danger hover:text-danger" disabled={pending} onClick={() => setConfirmCancel(true)}>
          <Ban aria-hidden />
          لغو
        </Button>,
      );
    }
  }

  // Full-width, stacked on phones (thumb-sized, in reading order: the main action first); two-up from `sm:`.
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ResponsiveModal open={confirmCancel} onOpenChange={setConfirmCancel} title="لغو تکلیف" description="این تکلیف برای همهٴ گیرندگان لغو می‌شود و از فهرست تکالیف بازشان برداشته می‌شود. بعداً می‌توانید آن را بازگشایی کنید.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setConfirmCancel(false)}>
            انصراف
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-w-28"
            disabled={pending}
            onClick={() => {
              setConfirmCancel(false);
              run("لغو شد", () => changeStatusAction({ workItemId, toStatusCode: "cancelled" }));
            }}
          >
            لغو تکلیف
          </Button>
        </div>
      </ResponsiveModal>
      {buttons}
      {inbox ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" className="w-full text-text-muted">
              <Ellipsis aria-hidden />
              گزینه‌های بیشتر
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() =>
                run(pinned ? "سنجاق برداشته شد" : "سنجاق شد", async () => {
                  const r = await setPinnedAction({ workItemId, pinned: !pinned });
                  if (r.ok) setPinned(r.data.pinned);
                  return r;
                })
              }
            >
              {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
              {pinned ? "برداشتن سنجاق" : "سنجاق به بالای پنل من"}
            </DropdownMenuItem>
            {inbox.state !== "archived" ? (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() =>
                  start(async () => {
                    const r = await archiveInboxAction({ workItemId });
                    if (r.ok) {
                      toast.success("از پنل شما بایگانی شد");
                      router.push("/inbox");
                    } else toast.error(r.message);
                  })
                }
              >
                <Archive aria-hidden />
                بایگانی در پنل من
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
