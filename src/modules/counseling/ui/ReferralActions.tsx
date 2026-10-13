"use client";

import { Send, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { v7 as uuidv7 } from "uuid";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { referToManagementAction, requestTeacherReportAction } from "../actions";
import { REFERRAL_BODY_MAX, REFERRAL_SUBJECT_MAX, REQUEST_MESSAGE_MAX } from "../policy";

export interface TeacherOption {
  personId: string;
  name: string;
  subjects: string[];
}

/**
 * The counselor's two ways out of the file, as the header's secondary actions: «ارجاع به مدیریت» (an administrative
 * request to the school's management, answered in their «پنل من») and «درخواست گزارش از دبیر» (to some of the
 * student's current teachers). Both are confidential work items; each form carries a key minted when it opens, so a
 * double tap sends one request.
 */
export function ReferralActions({ studentProfileId, studentName, teachers }: { studentProfileId: string; studentName: string; teachers: TeacherOption[] }) {
  const [open, setOpen] = useState<"management" | "teacher" | null>(null);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen("management")}>
        <Send aria-hidden className="rtl:-scale-x-100" />
        ارجاع به مدیریت
      </Button>
      {teachers.length > 0 ? (
        <Button type="button" variant="outline" onClick={() => setOpen("teacher")}>
          <UsersRound aria-hidden />
          درخواست گزارش از دبیر
        </Button>
      ) : null}
      <ResponsiveModal open={open === "management"} onOpenChange={(o) => setOpen(o ? "management" : null)} title="ارجاع به مدیریت" description={`دربارهٴ ${studentName} — مدیر و معاون مدرسه آن را در «پنل من» می‌بینند.`}>
        {open === "management" ? <ReferForm studentProfileId={studentProfileId} onClose={() => setOpen(null)} /> : null}
      </ResponsiveModal>
      <ResponsiveModal open={open === "teacher"} onOpenChange={(o) => setOpen(o ? "teacher" : null)} title="درخواست گزارش از دبیر" description={`دربارهٴ ${studentName} — هر دبیر گزارشش را برای شما می‌فرستد.`}>
        {open === "teacher" ? <RequestForm studentProfileId={studentProfileId} teachers={teachers} onClose={() => setOpen(null)} /> : null}
      </ResponsiveModal>
    </>
  );
}

function ReferForm({ studentProfileId, onClose }: { studentProfileId: string; onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idempotencyKey] = useState(() => uuidv7());
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || subject.trim() === "") return;
    start(async () => {
      const r = await referToManagementAction({ studentProfileId, subject: subject.trim(), description: description.trim() || undefined, urgent, idempotencyKey });
      if (r.ok) {
        toast.success("ارجاع برای مدیریت فرستاده شد");
        onClose();
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, ["subject", "description"]));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-subject`}>موضوع</Label>
        <Input id={`${ids}-subject`} dir="auto" maxLength={REFERRAL_SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثلاً: غیبت‌های پیاپی" aria-invalid={errors.subject ? true : undefined} />
        <FieldError text={errors.subject} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-description`}>
          شرح <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Textarea id={`${ids}-description`} dir="auto" rows={4} maxLength={REFERRAL_BODY_MAX} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={errors.description ? true : undefined} />
        <FieldError text={errors.description} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-text">
        <input type="checkbox" className="size-5 accent-primary-600" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        فوری
      </label>
      <FieldError text={errors.form} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          انصراف
        </Button>
        <Button type="submit" className="min-w-32" disabled={pending || subject.trim() === ""}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ارسال…" : "ارسال ارجاع"}
        </Button>
      </div>
    </form>
  );
}

function RequestForm({ studentProfileId, teachers, onClose }: { studentProfileId: string; teachers: TeacherOption[]; onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idempotencyKey] = useState(() => uuidv7());
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || picked.length === 0) return;
    start(async () => {
      const r = await requestTeacherReportAction({ studentProfileId, teacherPersonIds: picked, message: message.trim() || undefined, idempotencyKey });
      if (r.ok) {
        toast.success(picked.length > 1 ? "درخواست برای دبیران فرستاده شد" : "درخواست برای دبیر فرستاده شد");
        onClose();
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, ["teacherPersonIds", "message"]));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 pt-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-text">دبیران</legend>
        {teachers.map((t) => (
          <label key={t.personId} className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm text-text hover:bg-surface-sunken">
            <input type="checkbox" className="size-5 shrink-0 accent-primary-600" checked={picked.includes(t.personId)} onChange={(e) => toggle(t.personId, e.target.checked)} />
            <span className="flex min-w-0 flex-col">
              <bdi className="truncate">{t.name}</bdi>
              <span className="truncate text-meta text-text-muted">{t.subjects.join("، ")}</span>
            </span>
          </label>
        ))}
        <FieldError text={errors.teacherPersonIds} />
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-message`}>
          پیام <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Textarea id={`${ids}-message`} dir="auto" rows={3} maxLength={REQUEST_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="مثلاً: وضعیت درسی و رفتار او در کلاس شما چطور است؟" />
        <FieldError text={errors.message} />
      </div>
      <FieldError text={errors.form} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          انصراف
        </Button>
        <Button type="submit" className="min-w-32" disabled={pending || picked.length === 0}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ارسال…" : "ارسال درخواست"}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ text }: { text?: string }) {
  return (
    <p role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
