import { decryptInitialPassword } from "@/lib/crypto";
import { formatLoginIdentifierFa } from "@/lib/format";
import type { GuardianCredentialRow } from "@/modules/iam/guardian";
import { MESSAGES } from "@/modules/iam/service";
import { PrintButton } from "./PrintButton";

const PER_PAGE = 12;

/**
 * Server-rendered A4 «برگه‌های ورود اولیا» (the students' sheet's twin, same print CSS): one slip per guardian of the
 * class — the guardian's name, «ولیِ» the children in this class, the login and the initial password. The password is
 * decrypted here, right before rendering, and only where the server sent it (a guardian-only account still on its
 * initial password, all of whose children the caller manages); a colleague's slip says to use their own account.
 */
export function GuardianCredentialsSheet({ title, schoolName, rows }: { title: string; schoolName: string; rows: GuardianCredentialRow[] }) {
  const pages: GuardianCredentialRow[][] = [];
  for (let i = 0; i < rows.length; i += PER_PAGE) pages.push(rows.slice(i, i + PER_PAGE));
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {title} · {rows.length.toLocaleString("fa-IR")} برگه. برگه‌ها را چاپ کنید، از خط‌چین ببرید و به هر ولی بدهید. رمزها فقط تا اولین تغییر رمز خوانا می‌مانند.
        </p>
        <PrintButton />
      </div>
      {rows.length === 0 ? <p className="surface-work p-6 text-center text-sm text-text-muted">هنوز حساب ولی‌ای برای این کلاس ساخته نشده است؛ از صفحهٴ کلاس «ساخت حساب اولیا» را بزنید.</p> : null}
      {pages.map((page, i) => (
        <section key={i} className="print-page grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3 print:gap-2">
          {page.map((r) => (
            <Slip key={r.guardianPersonId} row={r} schoolName={schoolName} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Slip({ row, schoolName }: { row: GuardianCredentialRow; schoolName: string }) {
  const password = !row.isStaff && row.mustChangePassword ? decryptInitialPassword(row.initialPasswordEnc) : null;
  return (
    <article className="print-slip flex min-h-44 flex-col gap-1.5 surface-work p-3 text-sm text-text print:min-h-[60mm] print:rounded-none">
      <p className="text-meta text-text-muted">{schoolName}</p>
      <p className="text-base font-bold">
        <bdi>
          {row.firstName} {row.lastName}
        </bdi>
      </p>
      <p className="text-meta text-text-muted">
        ولیِ <bdi>{row.children.join("، ")}</bdi>
      </p>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-text-muted">نام‌کاربری</dt>
        <dd>
          <bdi dir="ltr" className="tabular font-semibold">
            {formatLoginIdentifierFa(row.loginIdentifier)}
          </bdi>
        </dd>
        <dt className="text-text-muted">رمز اولیه</dt>
        <dd>
          {row.isStaff ? (
            <span className="text-text-muted">رمز حساب همکاری خودتان</span>
          ) : password ? (
            <bdi dir="ltr" className="tabular text-base font-bold tracking-widest">
              {password}
            </bdi>
          ) : (
            <span className="text-text-muted">{MESSAGES.changed}</span>
          )}
        </dd>
      </dl>
      <p className="text-[11px] text-text-muted">{row.isStaff ? "با حساب همکاری خود وارد شوید؛ بخش فرزند در خانه است." : "در اولین ورود رمز را تغییر دهید."}</p>
    </article>
  );
}
