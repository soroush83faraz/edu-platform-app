"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { SubjectStamp } from "@/components/SubjectStamp";
import { Button } from "@/components/ui/button";
import { assignTeachingAction, endTeachingAction } from "@/lib/admin/people-actions";
import type { SelectOption } from "@/lib/admin/defineResource";
import { TEACHER_ROLE_LABELS, TEACHING_MESSAGES, teacherRoleLabel } from "@/lib/admin/labels";
import type { PersonDetail } from "@/lib/admin/people";
import type { TeachingClassOption, TeachingFormOptions } from "@/lib/admin/teaching";
import { Field, FieldError } from "./ResourceForm";
import { ResponsiveModal } from "./ResponsiveModal";

const ROLE_OPTIONS: SelectOption[] = Object.entries(TEACHER_ROLE_LABELS).map(([value, label]) => ({ value, label }));
const EXISTING_GROUP = "درس‌های این کلاس";
const NEW_GROUP = "درس تازه برای این کلاس";

/**
 * The «درس» picker of one class: its open offerings («ریاضی (دبیر فعلی: …)») and — where the caller may define
 * offerings — the catalog درس‌ها the class does not have in its current نوبت yet. Values are `o:<offering id>` and
 * `s:<subject id>`; `readPick` turns one back into the action's input.
 */
export function subjectPickOptions(cls: TeachingClassOption | undefined, subjects: SelectOption[]): SelectOption[] {
  if (!cls) return [];
  const multiTerm = new Set(cls.offerings.map((o) => o.termId)).size > 1;
  const existing = cls.offerings.map((o) => ({
    value: `o:${o.id}`,
    label: `${o.subjectName}${multiTerm ? ` — ${o.termName}` : ""} (${o.mainTeacher ? `دبیر فعلی: ${o.mainTeacher.name}` : "بدون دبیر"})`,
    group: EXISTING_GROUP,
  }));
  const taken = new Set(cls.offerings.filter((o) => o.termId === cls.currentTermId).map((o) => o.subjectId));
  const fresh =
    cls.canCreateOffering && cls.currentTermId
      ? subjects.filter((s) => !taken.has(s.value)).map((s) => ({ value: `s:${s.value}`, label: `${s.label} (ارائهٴ جدید)`, group: NEW_GROUP }))
      : [];
  return [...existing, ...fresh];
}

const readPick = (pick: string): { classOfferingId?: string; subjectId?: string } =>
  pick.startsWith("o:") ? { classOfferingId: pick.slice(2) } : pick.startsWith("s:") ? { subjectId: pick.slice(2) } : {};

/**
 * «تدریس» of a colleague (/admin/people/[id]): what they teach now (درس · کلاس · نقش) with «پایان تدریس», and
 * «افزودن تدریس» — both only for a caller holding `academic.teacher_assignment.write` (`canTeaching`); everyone else
 * reads the list. The write is the offerings page's, from the person's side (src/lib/admin/teaching.ts).
 */
export function TeachingCard({ detail, canTeaching, options }: { detail: PersonDetail; canTeaching: boolean; options: TeachingFormOptions | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const canAdd = canTeaching && options !== null && detail.status === "active" && detail.staff !== null;
  const endTeaching = (teacherAssignmentId: string) =>
    start(async () => {
      const r = await endTeachingAction({ teacherAssignmentId });
      if (r.ok) {
        toast.success("تدریس پایان یافت.");
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <section aria-labelledby="teaching-heading" className="flex flex-col gap-3 surface-work p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="teaching-heading" className="text-sm font-semibold text-text-muted">
          تدریس
        </h3>
        {canAdd ? (
          <Button type="button" variant="outline" className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            افزودن تدریس
          </Button>
        ) : null}
      </div>
      {detail.teaching.length === 0 ? (
        <p className="text-sm text-text-muted">هنوز درسی به این همکار سپرده نشده است.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {detail.teaching.map((t) => (
            <li key={t.teacherAssignmentId} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <SubjectStamp subjectId={t.subjectId} name={t.subjectName} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-row text-text">
                  {t.subjectName} · <bdi>{t.className}</bdi>
                </span>
                <span className="text-meta text-text-muted">{teacherRoleLabel(t.role)}</span>
              </div>
              {canTeaching ? (
                <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => endTeaching(t.teacherAssignmentId)} disabled={pending}>
                  پایان تدریس
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canAdd && options ? <AddTeachingDialog open={open} onOpenChange={setOpen} detail={detail} options={options} /> : null}
    </section>
  );
}

type Errors = { classGroupId?: string; subjectId?: string; role?: string; form?: string };

function AddTeachingDialog({ open, onOpenChange, detail, options }: { open: boolean; onOpenChange: (o: boolean) => void; detail: PersonDetail; options: TeachingFormOptions }) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [classId, setClassId] = useState("");
  const [pick, setPick] = useState("");
  const [role, setRole] = useState("main");
  const [errors, setErrors] = useState<Errors>({});
  /** Name of the main teacher being replaced — set = the confirm step is showing. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const name = `${detail.firstName} ${detail.lastName}`;
  const cls = options.classes.find((c) => c.value === classId);
  const picks = subjectPickOptions(cls, options.subjects);
  const offering = pick.startsWith("o:") ? cls?.offerings.find((o) => o.id === pick.slice(2)) : undefined;

  const reset = () => {
    setClassId("");
    setPick("");
    setRole("main");
    setErrors({});
    setConfirming(null);
  };
  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const send = (replaceMain: boolean) =>
    start(async () => {
      const r = await assignTeachingAction({ personId: detail.id, classGroupId: classId, ...readPick(pick), role, replaceMain });
      if (r.ok) {
        toast.success(r.data.offeringCreated ? "ارائهٴ درس ساخته و تدریس ثبت شد." : r.data.replaced ? "دبیر اصلی جایگزین شد." : "تدریس ثبت شد.");
        close(false);
        router.refresh();
        return;
      }
      // Someone set a main teacher meanwhile: ask, exactly as for a known one.
      if (r.code === "CONFLICT" && r.message === TEACHING_MESSAGES.mainTaken) {
        setConfirming(offering?.mainTeacher?.name ?? "");
        return;
      }
      setConfirming(null);
      const fe = r.fieldErrors ?? {};
      setErrors({ classGroupId: fe.classGroupId?.[0], subjectId: fe.subjectId?.[0] ?? fe.classOfferingId?.[0], role: fe.role?.[0], form: fe.classGroupId || fe.subjectId || fe.classOfferingId || fe.role ? undefined : r.message });
    });

  const submit = () => {
    const missing: Errors = {};
    if (!classId) missing.classGroupId = "کلاس را انتخاب کنید.";
    else if (!pick) missing.subjectId = TEACHING_MESSAGES.pickSubject;
    setErrors(missing);
    if (missing.classGroupId || missing.subjectId) return;
    // Replacing a main teacher is confirmed first (the server refuses it without `replaceMain` anyway).
    if (role === "main" && offering?.mainTeacher && offering.mainTeacher.staffProfileId !== detail.staff?.staffProfileId) {
      setConfirming(offering.mainTeacher.name);
      return;
    }
    send(false);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={close} title="افزودن تدریس" description={`کلاس، درس و نقش تدریسِ ${name} را انتخاب کنید.`}>
      {confirming !== null ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">{TEACHING_MESSAGES.mainTaken}</p>
          <p className="text-sm text-text-muted">
            {confirming ? (
              <>
                دبیر اصلیِ فعلی: <bdi className="font-medium text-text">{confirming}</bdi>.{" "}
              </>
            ) : null}
            با جایگزینی، تدریس او در این درس پایان می‌یابد و <bdi>{name}</bdi> دبیر اصلی می‌شود.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)} disabled={pending}>
              بازگشت
            </Button>
            <Button type="button" className="min-w-32" onClick={() => send(true)} disabled={pending}>
              {pending ? "…" : "جایگزین شود"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          {options.classes.length === 0 ? <p className="text-sm text-text-muted">در سال تحصیلی جاری کلاس فعالی در مدرسه‌های شما نیست.</p> : null}
          <Field
            field={{ name: "classGroupId", labelFa: "کلاس", type: "select", required: true }}
            id={`${ids}-class`}
            value={classId}
            error={errors.classGroupId}
            options={options.classes.map((c) => ({ value: c.value, label: c.label, ...(c.group ? { group: c.group } : {}) }))}
            onChange={(v) => {
              setClassId(String(v ?? ""));
              setPick("");
              setErrors({});
            }}
          />
          <Field
            field={{
              name: "subjectId",
              labelFa: "درس",
              type: "select",
              required: true,
              hint: cls && picks.length === 0 ? "این کلاس درسی ندارد و تعریف درس تازه با شما نیست." : undefined,
            }}
            id={`${ids}-subject`}
            value={pick}
            error={errors.subjectId}
            options={picks}
            onChange={(v) => {
              setPick(String(v ?? ""));
              setErrors((e) => ({ ...e, subjectId: undefined, form: undefined }));
            }}
          />
          <Field field={{ name: "role", labelFa: "نقش تدریس", type: "select", required: true }} id={`${ids}-role`} value={role} error={errors.role} options={ROLE_OPTIONS} onChange={(v) => setRole(String(v ?? "main"))} />
          <FieldError id={`${ids}-form`} text={errors.form} />
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              انصراف
            </Button>
            <Button type="submit" className="min-w-32" disabled={pending}>
              {pending ? "…" : "ثبت تدریس"}
            </Button>
          </div>
        </form>
      )}
    </ResponsiveModal>
  );
}
