import Link from "next/link";
import { Chip } from "@/components/Chip";
import type { StaffListRow, StudentListRow } from "@/lib/admin/people";
import { formatLoginIdentifierFa, formatNumberFa, toFaDigits } from "@/lib/format";

// The ONE row of «دانش‌آموزان» and «کارکنان» — the full lists (/admin/students, /admin/staff) and the school hub's
// compact sections render the same component, so a person reads the same everywhere.

const ROW = "pressable flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-surface-sunken";

/**
 * A student: name, then the meta line — student number, class, school (from `sm:`). A student without a class
 * reads a muted «بدون کلاس» and an account still on its initial password a muted «حساب فعال نشده» in that same
 * line (owner, 2026-09-27: facts in the row, not filter tabs above the list). The end chip is for the states that
 * need a hand: no account, locked; an active account reads «فعال».
 */
export function StudentRow({ row: r }: { row: StudentListRow }) {
  const pending = r.loginIdentifier !== null && r.accountStatus !== "locked" && r.mustChangePassword === true;
  return (
    <li>
      <Link href={`/admin/people/${r.personId}`} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-row font-medium text-text">
            <bdi>
              {r.firstName} {r.lastName}
            </bdi>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-meta text-text-muted">
            <bdi dir="ltr" className="tabular">
              {toFaDigits(r.studentNumber)}
            </bdi>
            {r.className ? <bdi>{r.className}</bdi> : <span>بدون کلاس</span>}
            {r.schoolName ? <span className="hidden sm:inline">{r.schoolName}</span> : null}
            {pending ? <span>حساب فعال نشده</span> : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {r.loginIdentifier === null ? <Chip tone="neutral">بدون حساب</Chip> : r.accountStatus === "locked" ? <Chip tone="danger">قفل</Chip> : pending ? null : <Chip tone="success">فعال</Chip>}
        </span>
      </Link>
    </li>
  );
}

/** A colleague: name, then login, manual roles and how many درس they teach; the end chip is the account state. */
export function StaffRow({ row: r }: { row: StaffListRow }) {
  return (
    <li>
      <Link href={`/admin/people/${r.personId}`} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-row font-medium text-text">
            <bdi>
              {r.firstName} {r.lastName}
            </bdi>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-meta text-text-muted">
            {r.loginIdentifier ? (
              <bdi dir="ltr" className="tabular">
                {formatLoginIdentifierFa(r.loginIdentifier)}
              </bdi>
            ) : null}
            {r.roles.map((x) => (
              <span key={x}>{x}</span>
            ))}
            {r.teaching > 0 ? <span>{formatNumberFa(r.teaching)} درس</span> : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {r.loginIdentifier === null ? <Chip tone="neutral">بدون حساب</Chip> : r.accountStatus === "locked" ? <Chip tone="danger">قفل</Chip> : r.mustChangePassword ? <Chip tone="warning">رمز اولیه</Chip> : <Chip tone="success">فعال</Chip>}
        </span>
      </Link>
    </li>
  );
}
