"use client";

import { KeyRound, LockOpen, Printer, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/Chip";
import { formatJalaliDateTime, formatNumberFa } from "@/lib/format";
import { assignRoleAction, createAccountAction, endTeachingAction, placeStudentAction, resetPasswordAction, revokeRoleAction, unlockAccountAction } from "@/lib/admin/people-actions";
import type { PersonDetail } from "@/lib/admin/people";
import { roleLabel } from "@/lib/admin/labels";
import type { AssignableRole, RoleGrantOptions } from "@/modules/iam/service";
import { CredentialsDialog, type Credentials } from "./CredentialsDialog";
import { ResponsiveModal } from "./ResponsiveModal";
import type { ClassOption, SchoolOption } from "./StudentForm";

interface Caps {
  canReset: boolean;
  canUnlock: boolean;
  canWritePerson: boolean;
  canEnroll: boolean;
  canRoles: boolean;
  canTeaching: boolean;
}

/** Account state + «تعیین رمز موقت» / «رفع قفل» / «ساخت حساب» / «چاپ اعتبارنامه». */
export function AccountCard({ detail, caps }: { detail: PersonDetail; caps: Caps }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const name = `${detail.firstName} ${detail.lastName}`;
  const acct = detail.account;
  // `lockedUntil` is compared server-side (PersonDetail.account.isLocked) so the render stays pure.
  const locked = acct && (acct.status === "locked" || acct.isLocked);

  const reset = () =>
    start(async () => {
      const r = await resetPasswordAction({ personId: detail.id });
      setConfirmReset(false);
      if (r.ok) {
        setCreds({ name, loginIdentifier: r.data.loginIdentifier, initialPassword: r.data.initialPassword });
        router.refresh();
      } else toast.error(r.message);
    });
  const unlock = () =>
    start(async () => {
      const r = await unlockAccountAction({ personId: detail.id });
      if (r.ok) {
        toast.success("قفل حساب برداشته شد.");
        router.refresh();
      } else toast.error(r.message);
    });
  const create = () =>
    start(async () => {
      const r = await createAccountAction({ personId: detail.id });
      if (r.ok) {
        setCreds({ name, loginIdentifier: r.data.loginIdentifier, initialPassword: r.data.initialPassword });
        router.refresh();
      } else toast.error(r.message);
    });

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-3 rounded-card bg-surface shadow-1 p-4">
      <h3 id="account-heading" className="text-sm font-semibold text-text-muted">
        حساب کاربری
      </h3>
      {acct ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-text-muted">شناسهٴ ورود</dt>
            <dd>
              <bdi dir="ltr" className="tabular font-medium text-text">
                {acct.loginIdentifier}
              </bdi>
            </dd>
            <dt className="text-text-muted">وضعیت</dt>
            <dd className="flex flex-wrap gap-1">
              {locked ? <Chip tone="danger">قفل‌شده</Chip> : acct.status === "disabled" ? <Chip tone="neutral">غیرفعال</Chip> : <Chip tone="success">فعال</Chip>}
              {acct.mustChangePassword ? <Chip tone="warning">رمز اولیه (فعال‌نشده)</Chip> : null}
              {acct.failedLoginCount > 0 ? <Chip tone="neutral">{formatNumberFa(acct.failedLoginCount)} تلاش ناموفق</Chip> : null}
            </dd>
            <dt className="text-text-muted">آخرین ورود</dt>
            <dd className="text-text">{acct.lastLoginAt ? formatJalaliDateTime(acct.lastLoginAt) : "هنوز وارد نشده"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {caps.canReset ? (
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setConfirmReset(true)} disabled={pending}>
                <KeyRound className="size-4" aria-hidden />
                تعیین رمز موقت
              </Button>
            ) : null}
            {caps.canUnlock && (locked || acct.failedLoginCount > 0) ? (
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={unlock} disabled={pending}>
                <LockOpen className="size-4" aria-hidden />
                رفع قفل
              </Button>
            ) : null}
            {caps.canReset && acct.mustChangePassword && acct.hasInitialPassword ? (
              <Button asChild variant="ghost" className="h-11 gap-2">
                <Link href={`/admin/people/${detail.id}/credentials`}>
                  <Printer className="size-4" aria-hidden />
                  چاپ اعتبارنامه
                </Link>
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">این فرد حساب کاربری ندارد و نمی‌تواند وارد سامانه شود.</p>
          {caps.canWritePerson ? (
            <Button type="button" className="h-11 gap-2 self-start" onClick={create} disabled={pending}>
              <UserPlus className="size-4" aria-hidden />
              ساخت حساب کاربری
            </Button>
          ) : null}
        </div>
      )}
      <ResponsiveModal open={confirmReset} onOpenChange={setConfirmReset} title="تعیین رمز موقت" description="رمز فعلی باطل می‌شود، همهٴ نشست‌های این حساب خارج می‌شوند و رمز جدید فقط یک‌بار نمایش داده می‌شود.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmReset(false)}>
            انصراف
          </Button>
          <Button type="button" className="h-11 min-w-32" onClick={reset} disabled={pending}>
            {pending ? "…" : "تعیین رمز موقت"}
          </Button>
        </div>
      </ResponsiveModal>
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </section>
  );
}

/** Current class + «انتقال / ثبت‌نام در کلاس». */
export function EnrollmentCard({ detail, classes, canEnroll }: { detail: PersonDetail; classes: ClassOption[]; canEnroll: boolean }) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState("");
  const move = () =>
    start(async () => {
      if (!target) return;
      const r = await placeStudentAction({ personId: detail.id, classGroupId: target });
      if (r.ok) {
        toast.success(r.data.moved ? "دانش‌آموز به کلاس جدید منتقل شد." : "ثبت‌نام انجام شد.");
        setTarget("");
        router.refresh();
      } else toast.error(r.message);
    });
  const groups = [...new Set(classes.map((c) => c.group).filter((g): g is string => !!g))];
  const options = classes.filter((c) => c.value !== detail.enrollment?.classGroupId);
  return (
    <section aria-labelledby="enroll-heading" className="flex flex-col gap-3 rounded-card bg-surface shadow-1 p-4">
      <h3 id="enroll-heading" className="text-sm font-semibold text-text-muted">
        کلاس
      </h3>
      {detail.enrollment ? (
        <p className="text-base text-text">
          <Link href={`/admin/classes/${detail.enrollment.classGroupId}`} className="font-medium text-primary-700 hover:underline">
            <bdi>{detail.enrollment.className}</bdi>
          </Link>
          <span className="text-text-muted">
            {" · "}
            {detail.enrollment.gradeName} · {detail.enrollment.schoolName} · {detail.enrollment.yearName}
          </span>
        </p>
      ) : (
        <p className="text-sm text-warning-text">در هیچ کلاسی ثبت‌نام نشده.</p>
      )}
      {canEnroll && options.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={id} className="sr-only">
            کلاس مقصد
          </label>
          <select id={id} value={target} onChange={(e) => setTarget(e.target.value)} className="h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-base">
            <option value="">{detail.enrollment ? "انتقال به کلاس…" : "ثبت‌نام در کلاس…"}</option>
            {groups.length > 0
              ? groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {options
                      .filter((o) => o.group === g)
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </optgroup>
                ))
              : options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
          </select>
          <Button type="button" variant="outline" className="h-11" onClick={move} disabled={pending || !target}>
            {detail.enrollment ? "انتقال" : "ثبت‌نام"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Manual roles (grant/revoke) and teaching assignments (end). */
/** Roles + teaching of a staff member. `roleGrant` (server-computed) limits the picker to roles/schools the caller may grant. */
export function RolesCard({ detail, caps, roleGrant }: { detail: PersonDetail; caps: Caps; roleGrant: RoleGrantOptions<SchoolOption> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ roleCode: string; schoolId: string }>({ roleCode: "", schoolId: roleGrant.schools[0]?.value ?? "" });
  const grant = () =>
    start(async () => {
      if (!draft.roleCode) return;
      const code = draft.roleCode as AssignableRole;
      const r = await assignRoleAction({ personId: detail.id, roleCode: code, schoolId: code === "org_admin" ? null : draft.schoolId || null });
      if (r.ok) {
        toast.success(r.data.created ? "نقش داده شد." : "این نقش از قبل وجود داشت.");
        setDraft((p) => ({ ...p, roleCode: "" }));
        router.refresh();
      } else toast.error(r.message);
    });
  const revoke = (roleAssignmentId: string) =>
    start(async () => {
      const r = await revokeRoleAction({ roleAssignmentId });
      if (r.ok) {
        toast.success("نقش لغو شد.");
        router.refresh();
      } else toast.error(r.message);
    });
  const endTeaching = (teacherAssignmentId: string) =>
    start(async () => {
      const r = await endTeachingAction({ teacherAssignmentId });
      if (r.ok) {
        toast.success("تدریس پایان یافت.");
        router.refresh();
      } else toast.error(r.message);
    });
  const roleOptions = roleGrant.roles.map((code) => ({ value: code, label: roleLabel(code) }));
  return (
    <section aria-labelledby="roles-heading" className="flex flex-col gap-3 rounded-card bg-surface shadow-1 p-4">
      <h3 id="roles-heading" className="text-sm font-semibold text-text-muted">
        نقش‌ها و تدریس
      </h3>
      {detail.roles.length === 0 && detail.teaching.length === 0 ? <p className="text-sm text-text-muted">نقش مدیریتی یا تدریسی ندارد.</p> : null}
      {detail.roles.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {detail.roles.map((r) => (
            <li key={r.roleAssignmentId} className="flex min-h-11 items-center justify-between gap-2 px-3 py-1 text-sm">
              <span className="text-text">
                {roleLabel(r.roleCode)}
                {r.schoolName ? <span className="text-text-muted"> — {r.schoolName}</span> : r.scopeType === "organization" ? <span className="text-text-muted"> — سازمان</span> : null}
              </span>
              {caps.canRoles && r.sourceType === "manual" ? (
                <Button type="button" variant="ghost" size="sm" className="h-9 text-danger" onClick={() => revoke(r.roleAssignmentId)} disabled={pending}>
                  لغو
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {detail.teaching.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {detail.teaching.map((t) => (
            <li key={t.teacherAssignmentId} className="flex min-h-11 items-center justify-between gap-2 px-3 py-1 text-sm">
              <span className="text-text">
                معلم {t.subjectName} <bdi>{t.className}</bdi>
              </span>
              {caps.canTeaching ? (
                <Button type="button" variant="ghost" size="sm" className="h-9 text-danger" onClick={() => endTeaching(t.teacherAssignmentId)} disabled={pending}>
                  پایان تدریس
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {caps.canRoles && detail.staff && roleOptions.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select aria-label="نقش جدید" value={draft.roleCode} onChange={(e) => setDraft((p) => ({ ...p, roleCode: e.target.value }))} className="h-11 rounded-lg border border-line bg-surface px-3 text-base">
            <option value="">افزودن نقش…</option>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select aria-label="مدرسهٴ نقش" value={draft.schoolId} onChange={(e) => setDraft((p) => ({ ...p, schoolId: e.target.value }))} disabled={draft.roleCode === "org_admin" || !draft.roleCode} className="h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:opacity-50">
            {roleGrant.schools.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" className="h-11" onClick={grant} disabled={pending || !draft.roleCode}>
            افزودن
          </Button>
        </div>
      ) : null}
    </section>
  );
}
