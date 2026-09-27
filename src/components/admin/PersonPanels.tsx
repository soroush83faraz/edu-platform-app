"use client";

import { KeyRound, LockOpen, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import { Chip } from "@/components/Chip";
import { formatJalaliDateTime, formatLoginIdentifierFa, formatNumberFa } from "@/lib/format";
import { createAccountAction, placeStudentAction, resetPasswordAction, unlockAccountAction } from "@/lib/admin/people-actions";
import type { PersonDetail } from "@/lib/admin/people";
import { roleLabel } from "@/lib/admin/labels";
import { CredentialsDialog, type Credentials } from "./CredentialsDialog";
import { ResponsiveModal } from "./ResponsiveModal";
import type { ClassOption } from "./StudentForm";

interface Caps {
  canReset: boolean;
  canUnlock: boolean;
  canWritePerson: boolean;
  canEnroll: boolean;
  canRoles: boolean;
  canTeaching: boolean;
}

/** Account state + «تعیین رمز موقت» / «رفع قفل» / «ساخت حساب». */
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
    <section aria-labelledby="account-heading" className="flex flex-col gap-3 surface-work p-4">
      <h3 id="account-heading" className="text-sm font-semibold text-text-muted">
        حساب کاربری
      </h3>
      {acct ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-text-muted">نام‌کاربری</dt>
            <dd>
              <bdi dir="ltr" className="tabular font-medium text-text">
                {formatLoginIdentifierFa(acct.loginIdentifier)}
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
              <Button type="button" variant="outline" className="gap-2" onClick={() => setConfirmReset(true)} disabled={pending}>
                <KeyRound className="size-4" aria-hidden />
                تعیین رمز موقت
              </Button>
            ) : null}
            {caps.canUnlock && (locked || acct.failedLoginCount > 0) ? (
              <Button type="button" variant="outline" className="gap-2" onClick={unlock} disabled={pending}>
                <LockOpen className="size-4" aria-hidden />
                رفع قفل
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">این فرد حساب کاربری ندارد و نمی‌تواند وارد سامانه شود.</p>
          {caps.canWritePerson ? (
            <Button type="button" className="gap-2 self-start" onClick={create} disabled={pending}>
              <UserPlus className="size-4" aria-hidden />
              ساخت حساب کاربری
            </Button>
          ) : null}
        </div>
      )}
      <ResponsiveModal open={confirmReset} onOpenChange={setConfirmReset} title="تعیین رمز موقت" description="رمز فعلی باطل می‌شود، این فرد از همهٴ دستگاه‌ها خارج می‌شود و رمز جدید فقط یک‌بار نمایش داده می‌شود.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setConfirmReset(false)}>
            انصراف
          </Button>
          <Button type="button" className="min-w-32" onClick={reset} disabled={pending}>
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
    <section aria-labelledby="enroll-heading" className="flex flex-col gap-3 surface-work p-4">
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
          <SelectNative id={id} value={target} onChange={(e) => setTarget(e.target.value)} wrapperClassName="flex-1">
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
          </SelectNative>
          <Button type="button" variant="outline" onClick={move} disabled={pending || !target}>
            {detail.enrollment ? "انتقال" : "ثبت‌نام"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Manager roles of a staff member — DISPLAY-ONLY here (owner, 2026-09-27: nobody changes a colleague's role «وسط کار»
 * from the staff pages): plain chips, no picker, no «لغو»; they are granted and revoked on /admin/roles only, and a
 * caller who may do that gets one line pointing there. Teaching has its own section (`TeachingCard`): it is the
 * teacher-assignment capability, not a manager-role change.
 */
export function RolesCard({ detail, caps }: { detail: PersonDetail; caps: Caps }) {
  return (
    <section aria-labelledby="roles-heading" className="flex flex-col gap-3 surface-work p-4">
      <h3 id="roles-heading" className="text-sm font-semibold text-text-muted">
        نقش‌ها
      </h3>
      {detail.roles.length === 0 ? <p className="text-sm text-text-muted">نقش مدیریتی ندارد.</p> : null}
      {detail.roles.length > 0 ? (
        <ul aria-label="نقش‌ها" className="flex flex-wrap gap-2">
          {detail.roles.map((r) => (
            <li key={r.roleAssignmentId}>
              <Chip tone="neutral">
                {roleLabel(r.roleCode)}
                {r.schoolName ? ` — ${r.schoolName}` : r.scopeType === "organization" ? " — سازمان" : ""}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
      {caps.canRoles ? (
        <p className="flex flex-wrap items-center gap-x-1 text-meta text-text-muted">
          نقش مدیر و معاون فقط در بخش
          <Link href="/admin/roles" className="inline-flex min-h-11 items-center font-medium text-primary-700 hover:underline">
            «نقش‌ها»
          </Link>
          داده یا لغو می‌شود.
        </p>
      ) : null}
    </section>
  );
}
