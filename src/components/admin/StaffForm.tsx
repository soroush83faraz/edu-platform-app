"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStaffAction, updateStaffAction } from "@/lib/admin/people-actions";
import type { PersonDetail } from "@/lib/admin/people";
import { CredentialsDialog, type Credentials } from "./CredentialsDialog";
import { Field, FieldError, flatten, type FormValue } from "./ResourceForm";
import type { SchoolOption } from "./StudentForm";

const EMPLOYMENT = [
  { value: "full_time", label: "تمام‌وقت" },
  { value: "part_time", label: "پاره‌وقت" },
  { value: "contractor", label: "حق‌التدریس" },
];
const GENDER = [
  { value: "female", label: "زن" },
  { value: "male", label: "مرد" },
];

/**
 * Staff form: person + phone account + primary school. Teachers get their role from class offerings; a manager role
 * («مدیر مدرسه» / «معاون») is NEVER set here — neither for a new colleague nor on the person page (owner, 2026-09-27:
 * roles are shown on the staff pages, granted and revoked on /admin/roles only).
 */
export function StaffForm({ schools, detail }: { schools: SchoolOption[]; detail?: PersonDetail }) {
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
    phone: detail?.account?.loginIdentifier ?? detail?.contactPhone ?? "",
    employeeNumber: detail?.staff?.employeeNumber ?? "",
    employmentType: detail?.staff?.employmentType ?? "full_time",
    schoolId: detail ? (detail.staff?.schoolId ?? "") : schools.length === 1 ? schools[0].value : "",
  });
  const set = (name: string) => (val: FormValue) => setV((p) => ({ ...p, [name]: val }));
  const f = (name: string) => ({ id: `${ids}-${name}`, value: v[name], error: errors[name], onChange: set(name) });

  // Fields on screen right now; an error on anything else is folded into the form-level line by `flatten`.
  const rendered = ["firstName", "lastName", "gender", "employeeNumber", "employmentType", ...(detail ? [] : ["phone"]), ...((detail && schools.length > 0) || (!detail && schools.length > 1) ? ["schoolId"] : [])];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = (k: string) => String(v[k] ?? "").trim();
    const opt = (k: string) => (s(k) ? s(k) : null);
    start(async () => {
      if (detail) {
        const r = await updateStaffAction({
          personId: detail.id,
          firstName: s("firstName"),
          lastName: s("lastName"),
          gender: (opt("gender") as "female" | "male" | null) ?? null,
          employeeNumber: opt("employeeNumber"),
          employmentType: s("employmentType") as "full_time" | "part_time" | "contractor",
          ...(schools.length > 0 ? { schoolId: opt("schoolId") } : {}),
        });
        if (r.ok) {
          toast.success("تغییرات ذخیره شد.");
          router.refresh();
          setErrors({});
        } else setErrors(flatten(r.fieldErrors, r.message, rendered));
        return;
      }
      const r = await createStaffAction({
        firstName: s("firstName"),
        lastName: s("lastName"),
        gender: (opt("gender") as "female" | "male" | null) ?? null,
        phone: s("phone"),
        employeeNumber: opt("employeeNumber"),
        employmentType: s("employmentType") as "full_time" | "part_time" | "contractor",
        schoolId: opt("schoolId"),
      });
      if (!r.ok) {
        setErrors(flatten(r.fieldErrors, r.message, rendered));
        return;
      }
      setErrors({});
      setCreatedId(r.data.personId);
      if (r.data.initialPassword) setCreds({ name: `${s("firstName")} ${s("lastName")}`, loginIdentifier: r.data.loginIdentifier, initialPassword: r.data.initialPassword });
      else router.push(`/admin/people/${r.data.personId}`);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field field={{ name: "firstName", labelFa: "نام", type: "text", required: true }} options={[]} {...f("firstName")} />
        <Field field={{ name: "lastName", labelFa: "نام خانوادگی", type: "text", required: true }} options={[]} {...f("lastName")} />
        {!detail ? <Field field={{ name: "phone", labelFa: "موبایل (شناسهٴ ورود)", type: "text", required: true, numeric: true, ltr: true, placeholder: "09121234567" }} options={[]} {...f("phone")} /> : null}
        <Field field={{ name: "gender", labelFa: "جنسیت", type: "select", options: GENDER }} options={GENDER} {...f("gender")} />
        <Field field={{ name: "employeeNumber", labelFa: "شمارهٴ کارمندی", type: "text", ltr: true, numeric: true }} options={[]} {...f("employeeNumber")} />
        <Field field={{ name: "employmentType", labelFa: "نوع همکاری", type: "select", options: EMPLOYMENT, required: true }} options={EMPLOYMENT} {...f("employmentType")} />
        {(detail && schools.length > 0) || (!detail && schools.length > 1) ? (
          <Field
            field={{ name: "schoolId", labelFa: "مدرسهٴ اصلی", type: "select", options: schools, hint: "مدیر و معاون همین مدرسه پرونده و حساب این همکار را می‌بینند؛ نقش «معلم» به‌تنهایی این دسترسی را نمی‌دهد." }}
            options={schools}
            {...f("schoolId")}
          />
        ) : null}
      </div>

      <FieldError id={`${ids}-form`} text={errors.form} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11" onClick={() => router.back()}>
          انصراف
        </Button>
        <Button type="submit" className="h-11 min-w-32" disabled={pending}>
          {pending ? "در حال ذخیره…" : detail ? "ذخیره" : "ثبت همکار"}
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
