"use client";

import { Archive, Ban, Check, Ellipsis, Pin, PinOff, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
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

/** Status buttons per role + the «بیشتر» menu (pin / archive). Marks my inbox row read once on mount. */
export function WorkItemActions({ workItemId, statusCategory, myAssigneeState, isManager, canUpdate, inbox }: WorkItemActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pinned, setPinned] = useState(inbox?.isPinned ?? false);

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

  if (canUpdate && isAssignee && !closed) {
    if (myAssigneeState === "pending") {
      buttons.push(
        <Button key="start" variant="outline" className="h-11 flex-1 px-4" disabled={pending} onClick={() => run("شروع شد", () => changeStatusAction({ workItemId, toStatusCode: "in_progress" }))}>
          <Play aria-hidden />
          شروع کردم
        </Button>,
      );
    }
    if (myAssigneeState !== "done") {
      buttons.push(
        <Button key="done" className="h-11 flex-1 px-4" disabled={pending} onClick={() => run("انجام شد", () => changeStatusAction({ workItemId, toStatusCode: "done" }))}>
          <Check aria-hidden />
          انجام شد
        </Button>,
      );
    }
  }
  if (canUpdate && isManager) {
    if (closed) {
      buttons.push(
        <Button key="reopen" variant="outline" className="h-11 flex-1 px-4" disabled={pending} onClick={() => run("بازگشایی شد", () => changeStatusAction({ workItemId, toStatusCode: "open" }))}>
          <RotateCcw aria-hidden />
          بازگشایی
        </Button>,
      );
    } else {
      buttons.push(
        <Button key="cancel" variant="ghost" className="h-11 px-4 text-danger hover:text-danger" disabled={pending} onClick={() => run("لغو شد", () => changeStatusAction({ workItemId, toStatusCode: "cancelled" }))}>
          <Ban aria-hidden />
          لغو
        </Button>,
      );
    }
  }

  return (
    <div className="flex items-center gap-2">
      {buttons}
      {inbox ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-11 shrink-0" aria-label="بیشتر">
              <Ellipsis aria-hidden />
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
              {pinned ? "برداشتن سنجاق" : "سنجاق به بالای کارتابل"}
            </DropdownMenuItem>
            {inbox.state !== "archived" ? (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() =>
                  start(async () => {
                    const r = await archiveInboxAction({ workItemId });
                    if (r.ok) {
                      toast.success("از کارتابل شما بایگانی شد");
                      router.push("/inbox");
                    } else toast.error(r.message);
                  })
                }
              >
                <Archive aria-hidden />
                بایگانی در کارتابل من
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
