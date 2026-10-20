"use client";

// «ثبت خروج مجاز» for ONE student, opened under their row on the roll-call page (a principal / vice principal /
// organization admin — `academic.early_exit.write`, owner 2026-10-20): the time the student leaves (Tehran clock,
// default now), the reason, an optional note and an optional «تحویل‌گیرنده». It saves on its own — it is not part of
// the roll call — and the later زنگ‌ها of the day open pre-marked «موجه» (leave-coverage); the page refreshes so the row
// shows the «خروج مجاز» tag. The server decides the scope and the one-per-day rule again.
import { DoorOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { EARLY_EXIT_CATEGORIES, EARLY_EXIT_CATEGORY_LABELS, EARLY_EXIT_NOTE_MAX, EARLY_EXIT_PICKUP_MAX, type EarlyExitCategory } from "@/lib/leave";
import { toFaDigits } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { recordEarlyExitAction } from "../leave-actions";

const FIELDS = ["studentProfileId", "time", "category", "note", "pickedUpBy"];

/** `HH:MM` on the Tehran wall clock right now (the field's default). */
function nowTehranClock(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" }).format(new Date());
  return parts;
}

export function EarlyExitPanel({ studentProfileId, studentName, onDone }: { studentProfileId: string; studentName: string; onDone: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [time, setTime] = useState(nowTehranClock);
  const [category, setCategory] = useState<EarlyExitCategory | "">("");
  const [note, setNote] = useState("");
  const [pickedUpBy, setPickedUpBy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || category === "") return;
    start(async () => {
      const r = await recordEarlyExitAction({
        studentProfileId,
        time,
        category,
        note: note.trim() === "" ? null : note.trim(),
        pickedUpBy: pickedUpBy.trim() === "" ? null : pickedUpBy.trim(),
      });
      if (!r.ok) {
        setErrors(flatten(r.fieldErrors, r.message, FIELDS));
        return;
      }
      toast.success(`خروج مجاز ${studentName} ثبت شد — ساعت ${toFaDigits(r.data.exitTime)}`);
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-label={`خروج مجاز ${studentName}`} className="surface-panel flex flex-col gap-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-time`}>ساعت خروج</Label>
          <Input id={`${ids}-time`} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={errors.time ? true : undefined} className="tabular text-start" />
          <FieldError text={errors.time} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-category`}>دلیل</Label>
          <SelectNative id={`${ids}-category`} value={category} onChange={(e) => setCategory(e.target.value as EarlyExitCategory | "")} aria-invalid={errors.category ? true : undefined}>
            <option value="">انتخاب کنید</option>
            {EARLY_EXIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EARLY_EXIT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </SelectNative>
          <FieldError text={errors.category} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-pickup`}>
          تحویل‌گیرنده <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Input id={`${ids}-pickup`} dir="auto" maxLength={EARLY_EXIT_PICKUP_MAX} value={pickedUpBy} onChange={(e) => setPickedUpBy(e.target.value)} aria-invalid={errors.pickedUpBy ? true : undefined} />
        <FieldError text={errors.pickedUpBy} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-note`}>
          توضیح <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Textarea id={`${ids}-note`} dir="auto" rows={2} maxLength={EARLY_EXIT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={errors.note ? true : undefined} className="min-h-20" />
        <FieldError text={errors.note} />
      </div>
      <FieldError text={errors.form ?? errors.studentProfileId} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          انصراف
        </Button>
        <Button type="submit" disabled={pending || category === ""}>
          <DoorOpen aria-hidden />
          {pending ? "در حال ثبت…" : "ثبت خروج مجاز"}
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
