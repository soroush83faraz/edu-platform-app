"use client";

import { MessageSquareReply } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { answerGuardianMessageAction } from "@/modules/iam/guardian-message-actions";
import { ANSWER_MAX } from "@/modules/iam/guardian-message-policy";

/**
 * «ثبت پاسخ» of a guardian's message in «مشاوره» › «پیام‌های اولیا» (a counselor has no «پنل من»): the answer — required,
 * it is what the guardian reads — closes the message for every addressee and tells the guardian that the school
 * answered (the bell names the child, never the answer).
 */
export function GuardianMessageAnswer({ workItemId, studentName }: { workItemId: string; studentName: string }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || answer.trim() === "") return;
    start(async () => {
      const r = await answerGuardianMessageAction({ workItemId, answer: answer.trim() });
      if (r.ok) {
        toast.success("پاسخ برای ولی فرستاده شد");
        setOpen(false);
        setAnswer("");
        router.refresh();
        return;
      }
      const errs = flatten(r.fieldErrors, r.message, ["answer"]);
      setError(errs.answer ?? errs.form);
    });
  };

  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <MessageSquareReply aria-hidden />
        ثبت پاسخ
      </Button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="ثبت پاسخ" description={`پاسخ شما برای ولیِ ${studentName} فرستاده می‌شود و این پیام برای همهٴ گیرندگان بسته می‌شود.`}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 pt-2">
          <Label htmlFor={`${ids}-answer`}>پاسخ</Label>
          <Textarea id={`${ids}-answer`} dir="auto" rows={5} maxLength={ANSWER_MAX} required value={answer} onChange={(e) => setAnswer(e.target.value)} aria-invalid={error ? true : undefined} />
          <p role="alert" className={cn("text-sm text-danger", !error && "hidden")}>
            {error}
          </p>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              انصراف
            </Button>
            <Button type="submit" className="min-w-28" disabled={pending || answer.trim() === ""}>
              <MessageSquareReply aria-hidden />
              {pending ? "در حال ثبت…" : "ثبت پاسخ"}
            </Button>
          </div>
        </form>
      </ResponsiveModal>
    </>
  );
}
