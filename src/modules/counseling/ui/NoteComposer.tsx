"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { createCounselorNoteAction } from "../actions";
import { NOTE_KIND_LABELS, NOTE_KINDS, NOTE_MAX, NOTE_VISIBILITIES, NOTE_VISIBILITY_LABELS, type NoteKind, type NoteVisibility } from "../policy";

const FIELDS = ["body", "kind", "visibility"];

/**
 * «یادداشت جدید» at the top of the counselor's notes: the text, its موضوع and who may read it — «مشاوران و مدیریت
 * مدرسه» by default, «فقط مشاوران» to keep it from the school's management. The one primary action of the file.
 */
export function NoteComposer({ studentProfileId }: { studentProfileId: string }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<NoteKind>("general");
  const [visibility, setVisibility] = useState<NoteVisibility>("counselors_and_principal");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || body.trim() === "") return;
    start(async () => {
      const r = await createCounselorNoteAction({ studentProfileId, kind, visibility, body: body.trim() });
      if (r.ok) {
        toast.success("یادداشت ثبت شد");
        setBody("");
        setErrors({});
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, FIELDS));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Label htmlFor={`${ids}-body`}>یادداشت جدید</Label>
      <Textarea
        id={`${ids}-body`}
        dir="auto"
        rows={4}
        maxLength={NOTE_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="آنچه در جلسه گذشت، نتیجه و پیگیری بعدی…"
        aria-invalid={errors.body ? true : undefined}
        aria-describedby={errors.body ? `${ids}-body-err` : undefined}
      />
      <p id={`${ids}-body-err`} role="alert" className={cn("text-sm text-danger", !errors.body && "hidden")}>
        {errors.body}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-kind`}>موضوع</Label>
          <SelectNative id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {NOTE_KIND_LABELS[k]}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-visibility`}>چه کسانی ببینند</Label>
          <SelectNative id={`${ids}-visibility`} value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
            {NOTE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {NOTE_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>
      <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
        {errors.form}
      </p>
      <div className="flex justify-end">
        <Button type="submit" className="w-full sm:w-auto" disabled={pending || body.trim() === ""}>
          <Check aria-hidden />
          {pending ? "در حال ثبت…" : "ثبت یادداشت"}
        </Button>
      </div>
    </form>
  );
}
