"use client";

import { Check, KeyRound, Plus, Unlink, UserMinus, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/Chip";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { addGuardianAction, keepGuardianLinkAction, resetGuardianPasswordAction, unlinkGuardianAction } from "@/lib/admin/guardian-actions";
import { formatLoginIdentifierFa, formatPhoneFa } from "@/lib/format";
import type { GuardianRow } from "@/modules/iam/guardian";
import { GUARDIAN_ACCOUNT_NOTES, GUARDIAN_PHONE_CHANGED_NOTICE, GUARDIAN_PHONE_MISMATCH_TAG, GUARDIAN_RELATIONS, RELATION_LABELS, relationLabel } from "@/modules/iam/guardian-policy";
import { CredentialsDialog, type Credentials } from "./CredentialsDialog";
import { Field, FieldError } from "./ResourceForm";
import { ResponsiveModal } from "./ResponsiveModal";

const RELATION_OPTIONS = GUARDIAN_RELATIONS.map((value) => ({ value, label: RELATION_LABELS[value] }));

/**
 * The login state of one guardian, as the account card names it — none at all for a guardian the caller's schools do
 * not know and may not act as (the server sent no login or state for them: D3).
 */
function AccountChip({ row }: { row: GuardianRow }) {
  if (!row.known && !row.manageable) return null;
  if (row.isStaff) return <Chip tone="neutral">حساب همکار</Chip>;
  if (!row.loginIdentifier) return <Chip tone="neutral">بدون حساب</Chip>;
  if (row.membershipStatus === "left" || row.accountStatus === "disabled") return <Chip tone="neutral">بسته</Chip>;
  if (row.accountStatus === "locked") return <Chip tone="danger">قفل</Chip>;
  if (row.mustChangePassword) return <Chip tone="warning">رمز اولیه</Chip>;
  return <Chip tone="success">فعال</Chip>;
}

/**
 * «اولیا» of a student (/admin/people/[id]): the live guardians — name, relation, «ولی اصلی», phone and login — then
 * «افزودن ولی» (name + phone + relation; the server decides whether that phone is a new account, a sibling's guardian,
 * a colleague's account or, when it is someone else's login, a generated username — and says which, except for a
 * person the caller's schools do not know: then only «شمارهٴ ثبت‌شده؛ اتصال انجام شد.», and the row reads «ولیِ
 * <student>» with no login — D3, the server masks it), «حذف از اولیا» (confirmed) and, for a guardian-only account
 * all of whose children the caller manages, «تعیین رمز موقت». A link made from a «ولی» phone the student no longer has
 * (D4a — changed or removed on the student form) is flagged: one notice above the list, the tag on the row, and two
 * one-tap answers in place of «حذف از اولیا»: «قطع اتصال» (ends it) and «حفظ اتصال» (reviewed, kept).
 * Writes need `iam.person.write` (`canWrite`); the password `iam.account.reset_password` (`canReset`). The server
 * re-checks everything; a password is shown ONCE (`CredentialsDialog`).
 */
export function GuardiansCard({
  studentProfileId,
  studentName,
  guardianPhone,
  rows,
  canWrite,
  canReset,
}: {
  studentProfileId: string;
  studentName: string;
  /** The student form's «شمارهٴ ولی» — offered as the new guardian's phone while nobody holds it yet. */
  guardianPhone: string | null;
  rows: GuardianRow[];
  canWrite: boolean;
  canReset: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GuardianRow | null>(null);
  const [resetting, setResetting] = useState<GuardianRow | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const suggestedPhone = guardianPhone && !rows.some((r) => r.phone === guardianPhone) ? guardianPhone : null;

  const unlink = (row: GuardianRow) =>
    start(async () => {
      const r = await unlinkGuardianAction({ linkId: row.linkId });
      setRemoving(null);
      if (r.ok) {
        toast.success(r.data.accessClosed ? "از اولیا حذف شد؛ این ولی فرزند دیگری در مدرسه ندارد و دسترسی‌اش بسته شد." : "از اولیای این دانش‌آموز حذف شد.");
        router.refresh();
      } else toast.error(r.message);
    });
  const keep = (row: GuardianRow) =>
    start(async () => {
      const r = await keepGuardianLinkAction({ linkId: row.linkId });
      if (r.ok) {
        toast.success("اتصال حفظ شد.");
        router.refresh();
      } else toast.error(r.message);
    });
  const toReview = rows.some((r) => r.phoneMismatch);
  const reset = (row: GuardianRow) =>
    start(async () => {
      const r = await resetGuardianPasswordAction({ linkId: row.linkId });
      setResetting(null);
      if (r.ok) {
        setCreds({ name: `${row.firstName} ${row.lastName}`, loginIdentifier: r.data.loginIdentifier, initialPassword: r.data.initialPassword });
        router.refresh();
      } else toast.error(r.message);
    });

  return (
    <section aria-labelledby="guardians-heading" className="flex flex-col gap-3 surface-work p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="guardians-heading" className="text-sm font-semibold text-text-muted">
          اولیا
        </h3>
        {canWrite ? (
          <Button type="button" variant="outline" className="gap-2" onClick={() => setAdding(true)} disabled={pending}>
            <Plus className="size-4" aria-hidden />
            افزودن ولی
          </Button>
        ) : null}
      </div>
      {toReview ? (
        <p role="status" className="surface-panel px-3 py-2 text-sm text-warning-text">
          {GUARDIAN_PHONE_CHANGED_NOTICE}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">هنوز ولی‌ای برای این دانش‌آموز ثبت نشده است؛ ولی با شمارهٴ موبایل خودش وارد می‌شود و تکالیف، حضور و غیاب و کارنامهٴ فرزندش را می‌بیند.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((row) => (
            <li key={row.linkId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <RowMark icon={UsersRound} />
                <div className="flex min-w-0 flex-col">
                  <p className="flex flex-wrap items-center gap-1.5 text-row text-text">
                    <bdi>
                      {row.firstName} {row.lastName}
                    </bdi>
                    <Chip tone="neutral">{relationLabel(row.relation)}</Chip>
                    {row.isPrimary ? <Chip tone="primary">ولی اصلی</Chip> : null}
                    {row.phoneMismatch ? <Chip tone="warning">{GUARDIAN_PHONE_MISMATCH_TAG}</Chip> : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-text-muted">
                    {row.phone ? (
                      <bdi dir="ltr" className="tabular">
                        {formatPhoneFa(row.phone)}
                      </bdi>
                    ) : null}
                    {row.loginIdentifier && row.loginIdentifier !== row.phone ? (
                      <span>
                        نام‌کاربری{" "}
                        <bdi dir="ltr" className="tabular">
                          {formatLoginIdentifierFa(row.loginIdentifier)}
                        </bdi>
                      </span>
                    ) : null}
                    <AccountChip row={row} />
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 sm:shrink-0">
                {canReset && row.manageable && row.loginIdentifier ? (
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setResetting(row)} disabled={pending}>
                    <KeyRound className="size-4" aria-hidden />
                    تعیین رمز موقت
                  </Button>
                ) : null}
                {canWrite && row.phoneMismatch ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-danger" onClick={() => unlink(row)} disabled={pending}>
                      <Unlink className="size-4" aria-hidden />
                      قطع اتصال
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => keep(row)} disabled={pending}>
                      <Check className="size-4" aria-hidden />
                      حفظ اتصال
                    </Button>
                  </>
                ) : canWrite ? (
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-danger" onClick={() => setRemoving(row)} disabled={pending}>
                    <UserMinus className="size-4" aria-hidden />
                    حذف از اولیا
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <AddGuardianDialog
          open={adding}
          onOpenChange={setAdding}
          studentProfileId={studentProfileId}
          studentName={studentName}
          suggestedPhone={suggestedPhone}
          onCreated={(c) => setCreds(c)}
        />
      ) : null}
      <ResponsiveModal
        open={removing !== null}
        onOpenChange={(o) => (!o ? setRemoving(null) : undefined)}
        title="حذف از اولیا"
        description={removing ? `${removing.firstName} ${removing.lastName} دیگر تکالیف، حضور و غیاب و کارنامهٴ ${studentName} را نمی‌بیند. اگر فرزند دیگری در این سازمان نداشته باشد، حسابش بسته می‌شود.` : undefined}
      >
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
            انصراف
          </Button>
          <Button type="button" className="min-w-32" onClick={() => removing && unlink(removing)} disabled={pending}>
            {pending ? "…" : "حذف از اولیا"}
          </Button>
        </div>
      </ResponsiveModal>
      <ResponsiveModal
        open={resetting !== null}
        onOpenChange={(o) => (!o ? setResetting(null) : undefined)}
        title="تعیین رمز موقت"
        description="رمز فعلی این ولی باطل می‌شود، از همهٴ دستگاه‌ها خارج می‌شود و رمز جدید فقط یک‌بار نمایش داده می‌شود."
      >
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setResetting(null)}>
            انصراف
          </Button>
          <Button type="button" className="min-w-32" onClick={() => resetting && reset(resetting)} disabled={pending}>
            {pending ? "…" : "تعیین رمز موقت"}
          </Button>
        </div>
      </ResponsiveModal>
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </section>
  );
}

type Errors = { firstName?: string; lastName?: string; phone?: string; relation?: string; form?: string };

function AddGuardianDialog({
  open,
  onOpenChange,
  studentProfileId,
  studentName,
  suggestedPhone,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentProfileId: string;
  studentName: string;
  suggestedPhone: string | null;
  onCreated: (c: Credentials) => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState(suggestedPhone ? formatPhoneFa(suggestedPhone) : "");
  const [relation, setRelation] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const close = (o: boolean) => {
    if (!o) {
      setFirstName("");
      setLastName("");
      setPhone(suggestedPhone ? formatPhoneFa(suggestedPhone) : "");
      setRelation("");
      setErrors({});
    }
    onOpenChange(o);
  };

  const submit = () => {
    const missing: Errors = {};
    if (!firstName.trim()) missing.firstName = "نام را وارد کنید.";
    if (!lastName.trim()) missing.lastName = "نام خانوادگی را وارد کنید.";
    if (!phone.trim()) missing.phone = "شمارهٴ موبایل ولی را وارد کنید.";
    if (!relation) missing.relation = "نسبت ولی را انتخاب کنید.";
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    start(async () => {
      const r = await addGuardianAction({ studentProfileId, firstName, lastName, phone, relation });
      if (r.ok) {
        const d = r.data;
        toast.success(d.alreadyLinked ? "این ولی از قبل به این دانش‌آموز وصل بود." : GUARDIAN_ACCOUNT_NOTES[d.accountKind]);
        close(false);
        if (d.account) onCreated({ name: `${firstName.trim()} ${lastName.trim()}`, loginIdentifier: d.account.loginIdentifier, initialPassword: d.account.initialPassword });
        router.refresh();
        return;
      }
      const fe = r.fieldErrors ?? {};
      setErrors({ firstName: fe.firstName?.[0], lastName: fe.lastName?.[0], phone: fe.phone?.[0], relation: fe.relation?.[0], form: fe.firstName || fe.lastName || fe.phone || fe.relation ? undefined : r.message });
    });
  };

  return (
    <ResponsiveModal open={open} onOpenChange={close} title="افزودن ولی" description={`ولیِ ${studentName} با این شماره وارد می‌شود؛ اگر این شماره از قبل حساب داشته باشد، همان حساب وصل می‌شود.`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <Field field={{ name: "firstName", labelFa: "نام", type: "text", required: true }} id={`${ids}-first`} value={firstName} error={errors.firstName} options={[]} onChange={(v) => setFirstName(String(v ?? ""))} />
        <Field field={{ name: "lastName", labelFa: "نام خانوادگی", type: "text", required: true }} id={`${ids}-last`} value={lastName} error={errors.lastName} options={[]} onChange={(v) => setLastName(String(v ?? ""))} />
        <Field
          field={{ name: "phone", labelFa: "شمارهٴ موبایل ولی", type: "text", required: true, numeric: true, ltr: true, placeholder: "09121234567" }}
          id={`${ids}-phone`}
          value={phone}
          error={errors.phone}
          options={[]}
          onChange={(v) => setPhone(String(v ?? ""))}
        />
        <Field field={{ name: "relation", labelFa: "نسبت", type: "select", required: true }} id={`${ids}-relation`} value={relation} error={errors.relation} options={RELATION_OPTIONS} onChange={(v) => setRelation(String(v ?? ""))} />
        <FieldError id={`${ids}-form`} text={errors.form} />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            انصراف
          </Button>
          <Button type="submit" className="min-w-32" disabled={pending}>
            {pending ? "…" : "افزودن ولی"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
