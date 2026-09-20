"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStudentAction, updateStudentAction } from "@/lib/admin/people-actions";
import type { PersonDetail } from "@/lib/admin/people";
import { CredentialsDialog, type Credentials } from "./CredentialsDialog";
import { Field, FieldError, flatten, type FormValue } from "./ResourceForm";

export interface ClassOption {
  value: string;
  label: string;
  group?: string;
  schoolId: string;
}

export interface SchoolOption {
  value: string;
  label: string;
  code?: string;
}

interface Props {
  classes: ClassOption[];
  schools: SchoolOption[];
  /** Edit mode when given. */
  detail?: PersonDetail;
}

const GENDER = [
  { value: "female", label: "دختر" },
  { value: "male", label: "پسر" },
];

/** Composite student form: person + optional account + optional class enrollment in ONE action. */
export function StudentForm({ classes, schools, detail }: Props) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, FormValue>>({
    firstName: detail?.firstName ?? "",
    lastName: detail?.lastName ?? "",
    gender: detail?.gender ?? "",
    studentNumber: detail?.student?.studentNumber ?? "",
    externalRef: detail?.externalRef ?? "",
    contactPhone: detail?.contactPhone ?? "",
    guardianPhone: detail?.guardianPhone ?? "",
    classGroupId: "",
    schoolId: schools.length === 1 ? schools[0].value : "",
    createAccount: true,
    identifier: "",
  });
  const set = (name: string) => (val: FormValue) => setV((p) => ({ ...p, [name]: val }));
  const f = (name: string) => ({ id: `${ids}-${name}`, value: v[name], error: errors[name], onChange: set(name) });
  const classId = String(v.classGroupId ?? "");
  const schoolFieldShown = !detail && !classId && schools.length > 1;
  const schoolOfClass = classes.find((c) => c.value === classId)?.schoolId;
  const schoolCode = schools.find((s) => s.value === (schoolOfClass ?? v.schoolId))?.code;
  const phone = String(v.contactPhone ?? "").trim();
  const hint = String(v.identifier ?? "").trim()
    ? undefined
    : phone
      ? "خالی = همان شمارهٴ موبایل دانش‌آموز."
      : schoolCode
        ? `خالی = نام‌کاربری تولیدی «${schoolCode.toLowerCase()}-${String(v.studentNumber ?? "").trim() || "شماره"}».`
        : "بدون موبایل، نام‌کاربری از کد مدرسه و شمارهٴ دانش‌آموزی ساخته می‌شود.";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = (k: string) => String(v[k] ?? "").trim();
    const opt = (k: string) => (s(k) ? s(k) : null);
    start(async () => {
      if (detail) {
        const r = await updateStudentAction({
          personId: detail.id,
          firstName: s("firstName"),
          lastName: s("lastName"),
          gender: (opt("gender") as "female" | "male" | null) ?? null,
          studentNumber: s("studentNumber"),
          externalRef: opt("externalRef"),
          contactPhone: opt("contactPhone"),
          guardianPhone: opt("guardianPhone"),
        });
        if (r.ok) {
          toast.success("تغییرات ذخیره شد.");
          router.refresh();
          setErrors({});
        } else setErrors(flatten(r.fieldErrors, r.message));
        return;
      }
      const r = await createStudentAction({
        firstName: s("firstName"),
        lastName: s("lastName"),
        gender: (opt("gender") as "female" | "male" | null) ?? null,
        studentNumber: s("studentNumber"),
        externalRef: opt("externalRef"),
        contactPhone: opt("contactPhone"),
        guardianPhone: opt("guardianPhone"),
        schoolId: opt("schoolId") ?? undefined,
        classGroupId: opt("classGroupId"),
        createAccount: v.createAccount === true,
        identifier: opt("identifier"),
      });
      if (!r.ok) {
        setErrors(flatten(r.fieldErrors, r.message));
        return;
      }
      setErrors({});
      setCreatedId(r.data.personId);
      if (r.data.initialPassword && r.data.loginIdentifier) {
        setCreds({ name: `${s("firstName")} ${s("lastName")}`, loginIdentifier: r.data.loginIdentifier, initialPassword: r.data.initialPassword });
      } else {
        toast.success("دانش‌آموز ثبت شد.");
        router.push(`/admin/people/${r.data.personId}`);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field field={{ name: "firstName", labelFa: "نام", type: "text", required: true }} options={[]} {...f("firstName")} />
        <Field field={{ name: "lastName", labelFa: "نام خانوادگی", type: "text", required: true }} options={[]} {...f("lastName")} />
        <Field field={{ name: "studentNumber", labelFa: "شمارهٴ دانش‌آموزی", type: "text", required: true, numeric: true, ltr: true, placeholder: "14050001" }} options={[]} {...f("studentNumber")} />
        <Field field={{ name: "gender", labelFa: "جنسیت", type: "select", options: GENDER }} options={GENDER} {...f("gender")} />
        <Field field={{ name: "contactPhone", labelFa: "موبایل دانش‌آموز", type: "text", numeric: true, ltr: true, placeholder: "09121234567" }} options={[]} {...f("contactPhone")} />
        <Field field={{ name: "guardianPhone", labelFa: "شمارهٴ ولی", type: "text", numeric: true, ltr: true, placeholder: "09121234567" }} options={[]} {...f("guardianPhone")} />
        <Field field={{ name: "externalRef", labelFa: "کد یکتا (سامانهٴ قبلی)", type: "text", ltr: true }} options={[]} {...f("externalRef")} />
      </div>

      {!detail ? (
        <>
          <fieldset className="flex flex-col gap-4 rounded-card bg-surface shadow-1 p-4">
            <legend className="px-1 text-sm font-semibold text-text-muted">کلاس</legend>
            <Field field={{ name: "classGroupId", labelFa: "کلاس", type: "select", optionsKey: "classes", hint: "می‌توانید بعداً از صفحهٴ دانش‌آموز تعیین کنید." }} options={classes} {...f("classGroupId")} />
            {schoolFieldShown ? (
              <Field field={{ name: "schoolId", labelFa: "مدرسه (بدون کلاس)", type: "select", options: schools, required: true, hint: "دانش‌آموز بدون کلاس هم به یک مدرسه تعلق دارد؛ مدیر همان مدرسه پروندهٴ او را می‌بیند." }} options={schools} {...f("schoolId")} />
            ) : null}
          </fieldset>
          <fieldset className="flex flex-col gap-4 rounded-card bg-surface shadow-1 p-4">
            <legend className="px-1 text-sm font-semibold text-text-muted">حساب کاربری</legend>
            <Field field={{ name: "createAccount", labelFa: "حساب کاربری بساز (رمز اولیه یک‌بار نمایش داده می‌شود)", type: "toggle" }} options={[]} {...f("createAccount")} />
            {v.createAccount === true ? <Field field={{ name: "identifier", labelFa: "شناسهٴ ورود", type: "text", ltr: true, hint }} options={[]} {...f("identifier")} /> : null}
          </fieldset>
        </>
      ) : null}

      {/* A school error with no visible school field (one school, or a class chosen) surfaces at the form level. */}
      <FieldError id={`${ids}-form`} text={errors.form ?? (!schoolFieldShown ? errors.schoolId : undefined)} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11" onClick={() => router.back()}>
          انصراف
        </Button>
        <Button type="submit" className="h-11 min-w-32" disabled={pending}>
          {pending ? "در حال ذخیره…" : detail ? "ذخیره" : "ثبت دانش‌آموز"}
        </Button>
      </div>
      <CredentialsDialog
        creds={creds}
        onClose={() => {
          setCreds(null);
          if (createdId) router.push(`/admin/people/${createdId}`);
        }}
      />
    </form>
  );
}
