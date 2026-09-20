"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addCommentAction } from "../actions";

export function CommentForm({ workItemId, canStaffOnly }: { workItemId: string; canStaffOnly: boolean }) {
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
      <label htmlFor="comment-body" className="text-sm font-medium text-text">
        نظر جدید
      </label>
      <textarea
        id="comment-body"
        name="body"
        dir="auto"
        rows={3}
        maxLength={4000}
        required
        placeholder="مثلاً: انجام دادم، فقط سؤال ۳ را نفهمیدم."
        aria-invalid={error ? true : undefined}
        aria-describedby="comment-error"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base leading-7 outline-none placeholder:text-text-faint focus-visible:border-primary-400 focus-visible:ring-3 focus-visible:ring-primary-400/30 aria-invalid:border-danger"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canStaffOnly ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" name="staffOnly" className="size-4 accent-primary-600" />
            فقط برای کادر مدرسه
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" className="h-11 px-5" disabled={pending}>
          {pending ? "در حال ثبت…" : "ثبت نظر"}
        </Button>
      </div>
      <p id="comment-error" role="alert" className="min-h-5 text-sm text-danger">
        {error}
      </p>
    </form>
  );
}
