"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { v7 as uuidv7 } from "uuid";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { sendGuardianMessageAction } from "@/modules/iam/guardian-message-actions";
import {
  CRITICISM_ROUTE_NOTE,
  DESTINATION_LABELS,
  MESSAGE_BODY_MAX,
  MESSAGE_KIND_LABELS,
  MESSAGE_KINDS,
  MESSAGE_SUBJECT_MAX,
  isAllowedDestination,
  teacherDestinationLabel,
  type MessageDestination,
  type MessageKind,
} from "@/modules/iam/guardian-message-policy";

type Office = Exclude<MessageDestination, "teacher">;

export interface ComposerTeacher {
  classOfferingId: string;
  subjectName: string;
  teacherPersonId: string;
  teacherName: string;
}

const FIELDS = ["kind", "destination", "subject", "body"];

/** The select's value of a teacher row: `teacher:<offering>:<person>`; an office is its own code. */
const teacherValue = (t: ComposerTeacher) => `teacher:${t.classOfferingId}:${t.teacherPersonId}`;

/**
 * «پیام تازه» of «پیام به مدرسه» (owner, 2026-10-19): the kind («سؤال» / «پیشنهاد» / «انتقاد»), whom it goes to — a
 * teacher of one of the child's درس‌ها («<درس> — <دبیر>») or the school's counselor / vice principal / principal, only
 * the ones the school has — the subject and the text, then «ارسال پیام». Only valid combinations are offered: with
 * «انتقاد» the teachers leave the list and one line says where it goes (the server refuses it anyway). A key minted per
 * message makes a double tap send one; the next message gets a new key.
 */
export function MessageComposer({ child, childFirstName, teachers, offices }: { child: string; childFirstName: string; teachers: ComposerTeacher[]; offices: Office[] }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => uuidv7());
  const [kind, setKind] = useState<MessageKind>("question");
  const [destination, setDestination] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const teacherAllowed = isAllowedDestination(kind, "teacher");
  const pickKind = (k: MessageKind) => {
    setKind(k);
    // A teacher picked before «انتقاد» is no longer a valid choice: back to «انتخاب کنید».
    if (!isAllowedDestination(k, "teacher") && destination.startsWith("teacher:")) setDestination("");
  };
  const ready = destination !== "" && subject.trim() !== "" && body.trim() !== "";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || !ready) return;
    const [dest, classOfferingId, teacherPersonId] = destination.split(":");
    start(async () => {
      const r = await sendGuardianMessageAction({
        child,
        kind,
        destination: dest as MessageDestination,
        ...(dest === "teacher" ? { classOfferingId, teacherPersonId } : {}),
        subject: subject.trim(),
        body: body.trim(),
        idempotencyKey,
      });
      if (r.ok) {
        toast.success("پیام فرستاده شد");
        setSubject("");
        setBody("");
        setDestination("");
        setErrors({});
        setIdempotencyKey(uuidv7());
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, FIELDS));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium text-text">نوع پیام</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1">
          {MESSAGE_KINDS.map((k) => {
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickKind(k)}
                className={cn("pressable min-h-11 rounded-lg px-3 text-sm font-medium transition-colors", on ? "bg-surface text-primary-800 shadow-1" : "text-text-muted hover:bg-surface")}
              >
                {MESSAGE_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-destination`}>گیرنده</Label>
        <SelectNative
          id={`${ids}-destination`}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          aria-invalid={errors.destination ? true : undefined}
          aria-describedby={`${ids}-destination-hint`}
        >
          <option value="">انتخاب کنید</option>
          {teacherAllowed && teachers.length > 0 ? (
            <optgroup label={`دبیران ${childFirstName}`}>
              {teachers.map((t) => (
                <option key={teacherValue(t)} value={teacherValue(t)}>
                  {teacherDestinationLabel(t.subjectName, t.teacherName)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {offices.length > 0 ? (
            <optgroup label="مدرسه">
              {offices.map((o) => (
                <option key={o} value={o}>
                  {DESTINATION_LABELS[o]}
                </option>
              ))}
            </optgroup>
          ) : null}
        </SelectNative>
        <p id={`${ids}-destination-hint`} className={cn("text-meta text-text-muted", teacherAllowed && "hidden")}>
          {CRITICISM_ROUTE_NOTE}.
        </p>
        <FieldError text={errors.destination} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-subject`}>موضوع</Label>
        <Input
          id={`${ids}-subject`}
          dir="auto"
          maxLength={MESSAGE_SUBJECT_MAX}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="مثلاً: تکلیف‌های ریاضی هفتهٴ گذشته"
          aria-invalid={errors.subject ? true : undefined}
        />
        <FieldError text={errors.subject} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-body`}>متن پیام</Label>
        <Textarea id={`${ids}-body`} dir="auto" rows={5} maxLength={MESSAGE_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={errors.body ? true : undefined} />
        <FieldError text={errors.body} />
      </div>

      <FieldError text={errors.form ?? errors.kind} />
      <div className="flex justify-end">
        <Button type="submit" className="w-full sm:w-auto sm:min-w-36" disabled={pending || !ready}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ارسال…" : "ارسال پیام"}
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
