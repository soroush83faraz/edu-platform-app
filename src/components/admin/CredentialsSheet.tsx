import { decryptInitialPassword } from "@/lib/crypto";
import type { CredentialRow } from "@/lib/admin/people";
import { MESSAGES } from "@/modules/iam/service";
import { PrintButton } from "./PrintButton";

const PER_PAGE = 12;

/**
 * Server-rendered A4 credentials sheet: 3×4 cut-out slips per page (print CSS in globals.css). The initial
 * password is decrypted here, right before rendering; an account whose password was already changed (or whose
 * encrypted copy was cleared) shows «— تغییر داده شده» instead.
 */
export function CredentialsSheet({ title, schoolName, rows }: { title: string; schoolName: string; rows: CredentialRow[] }) {
  const pages: CredentialRow[][] = [];
  for (let i = 0; i < rows.length; i += PER_PAGE) pages.push(rows.slice(i, i + PER_PAGE));
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {title} · {rows.length.toLocaleString("fa-IR")} برگه. برگه‌ها را چاپ کنید، از خط‌چین ببرید و به هر نفر بدهید. رمزها فقط تا اولین تغییر رمز خوانا می‌مانند.
        </p>
        <PrintButton />
      </div>
      {rows.length === 0 ? <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-text-muted">حسابی برای چاپ وجود ندارد.</p> : null}
      {pages.map((page, i) => (
        <section key={i} className="print-page grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3 print:gap-2">
          {page.map((r) => (
            <Slip key={r.personId} row={r} schoolName={schoolName} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Slip({ row, schoolName }: { row: CredentialRow; schoolName: string }) {
  const password = row.mustChangePassword ? decryptInitialPassword(row.initialPasswordEnc) : null;
  return (
    <article className="print-slip flex min-h-44 flex-col gap-1.5 rounded-card border border-line bg-surface p-3 text-sm text-text print:min-h-[60mm] print:rounded-none">
      <p className="text-xs text-text-muted">{schoolName}</p>
      <p className="text-base font-bold">
        <bdi>
          {row.firstName} {row.lastName}
        </bdi>
      </p>
      <p className="text-xs text-text-muted">
        {row.className ? <bdi>کلاس {row.className}</bdi> : null}
        {row.studentNumber ? (
          <>
            {row.className ? " · " : ""}
            <bdi dir="ltr" className="tabular">
              {row.studentNumber}
            </bdi>
          </>
        ) : null}
      </p>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-text-muted">شناسهٴ ورود</dt>
        <dd>
          <bdi dir="ltr" className="tabular font-semibold">
            {row.loginIdentifier}
          </bdi>
        </dd>
        <dt className="text-text-muted">رمز اولیه</dt>
        <dd>{password ? <bdi dir="ltr" className="tabular text-base font-bold tracking-widest">{password}</bdi> : <span className="text-text-muted">{MESSAGES.changed}</span>}</dd>
      </dl>
      <p className="text-[11px] text-text-muted">در اولین ورود رمز را تغییر دهید.</p>
    </article>
  );
}
