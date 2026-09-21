"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStaffAction, updateStaffAction } from "@/lib/admin/people-actions";
import type { PersonDetail } from "@/lib/admin/people";
import { roleLabel } from "@/lib/admin/labels";
import type { AssignableRole, RoleGrantOptions } from "@/modules/iam/service";
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

interface RoleGrant {
  roleCode: AssignableRole;
  schoolId: string | null;
}

/**
 * Staff form: person + phone account (+ optional manager roles). Teachers get their role from class offerings.
 * `roleGrant` (server-computed from the caller's assignments, `roleGrantOptions`) lists the roles the caller may
 * grant and the schools where; empty → no role picker (a vice principal registers staff but grants nothing).
 */
export function StaffForm({ schools, detail, roleGrant }: { schools: SchoolOption[]; detail?: PersonDetail; roleGrant: RoleGrantOptions<SchoolOption> }) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleGrant[]>([]);
  const [roleDraft, setRoleDraft] = useState<{ roleCode: string; schoolId: string }>({ roleCode: "", schoolId: roleGrant.schools[0]?.value ?? "" });
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
  const roleOptions = [{ value: "", label: "بدون نقش مدیریتی (دبیر عادی)" }, ...roleGrant.roles.map((code) => ({ value: code, label: roleLabel(code) }))];

  const addRole = () => {
    if (!roleDraft.roleCode) return;
    const code = roleDraft.roleCode as AssignableRole;
    const schoolId = code === "org_admin" ? null : roleDraft.schoolId || null;
    if (code !== "org_admin" && !schoolId) {
      setErrors((p) => ({ ...p, roles: "برای این نقش، مدرسه را انتخاب کنید." }));
      return;
    }
    if (roles.some((r) => r.roleCode === code && r.schoolId === schoolId)) return;
    setRoles((p) => [...p, { roleCode: code, schoolId }]);
    setErrors((p) => ({ ...p, roles: "" }));
  };

  // Fields on screen right now; an error on anything else is folded into the form-level line by `flatten`.
  const rendered = ["firstName", "lastName", "gender", "employeeNumber", "employmentType", "roles", ...(detail ? [] : ["phone"]), ...((detail && schools.length > 0) || (!detail && schools.length > 1) ? ["schoolId"] : [])];

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
        roles,
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

      {!detail && roleGrant.roles.length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-card bg-surface shadow-1 p-4">
          <legend className="px-1 text-sm font-semibold text-text-muted">نقش مدیریتی (اختیاری)</legend>
          <p className="text-xs text-text-muted">نقش «معلم» این‌جا داده نمی‌شود؛ با تخصیص دبیر به ارائهٴ درس در صفحهٴ کلاس ساخته می‌شود.</p>
          {roles.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {roles.map((r, i) => (
                <li key={i}>
                  <button type="button" onClick={() => setRoles((p) => p.filter((_, j) => j !== i))} className="inline-flex h-9 items-center gap-1 rounded-full bg-primary-50 ps-3 pe-2 text-sm text-primary-700" aria-label="حذف نقش">
                    {roleLabel(r.roleCode)}
                    {r.schoolId ? ` — ${schools.find((s) => s.value === r.schoolId)?.label ?? ""}` : ""}
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select aria-label="نقش" value={roleDraft.roleCode} onChange={(e) => setRoleDraft((p) => ({ ...p, roleCode: e.target.value }))} className="h-11 rounded-lg border border-line bg-surface px-3 text-base">
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select aria-label="مدرسهٴ نقش" value={roleDraft.schoolId} onChange={(e) => setRoleDraft((p) => ({ ...p, schoolId: e.target.value }))} disabled={roleDraft.roleCode === "org_admin" || !roleDraft.roleCode} className="h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:opacity-50">
              {roleGrant.schools.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" className="h-11" onClick={addRole} disabled={!roleDraft.roleCode}>
              افزودن نقش
            </Button>
          </div>
          <FieldError id={`${ids}-roles`} text={errors.roles} />
        </fieldset>
      ) : null}

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
