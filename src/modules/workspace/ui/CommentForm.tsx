"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction } from "../actions";

/** `privateToStaff`: the viewer is one of several assignees — their comment reaches the creator and staff only (service rule). */
export function CommentForm({ workItemId, canStaffOnly, privateToStaff = false }: { workItemId: string; canStaffOnly: boolean; privateToStaff?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") ?? "").trim();
    const staffOnly = fd.get("staffOnly") === "on";
    if (!body) {
      setError("متن نظر را وارد کنید.");
      return;
    }
    start(async () => {
      const r = await addCommentAction({ workItemId, body, visibility: staffOnly ? "staff_only" : "all" });
      if (r.ok) {
        setError(null);
        formRef.current?.reset();
        toast.success("نظر ثبت شد");
        router.refresh();
      } else setError(r.fieldErrors?.body?.[0] ?? r.message);
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <Label htmlFor="comment-body">نظر جدید</Label>
      <Textarea
        id="comment-body"
        name="body"
        dir="auto"
        rows={3}
        maxLength={4000}
        required
        placeholder="مثلاً: انجام دادم، فقط سؤال ۳ را نفهمیدم."
        aria-invalid={error ? true : undefined}
        aria-describedby="comment-error"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canStaffOnly ? (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 py-2 pe-2 text-sm text-text-muted">
            <input type="checkbox" name="staffOnly" className="size-5 accent-primary-600" />
            فقط برای کادر مدرسه
          </label>
        ) : privateToStaff ? (
          <span className="text-sm leading-6 text-text-muted">نظر شما فقط برای معلم و کادر مدرسه دیده می‌شود.</span>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "در حال ثبت…" : "ثبت نظر"}
        </Button>
      </div>
      <p id="comment-error" role="alert" className="min-h-6 text-sm leading-6 text-danger">
        {error}
      </p>
    </form>
  );
}
