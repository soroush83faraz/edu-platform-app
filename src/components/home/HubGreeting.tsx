import { formatJalaliWeekdayDate } from "@/lib/format";
import { getShellContext } from "@/lib/shell-context";

/**
 * The top of Home in the hub layout, on every size (owner, 2026-09-27): ONE white card with «سلام، <first name>»,
 * today's Jalali weekday and date, and the school as a muted meta line — the hub's top bar names no school and the
 * separate school-name box is gone, but which school you are in still matters. The school follows the shell's
 * rule (`AppShell`): an admin whose scope holds several schools is introduced by the ORGANIZATION. Static: no link,
 * no hover.
 */
export async function HubGreeting({ firstName, schoolName, orgName }: { firstName: string; schoolName: string | null; orgName: string }) {
  const shell = await getShellContext();
  const school = (shell.schools.length > 1 ? orgName : schoolName) ?? orgName;
  return (
    <header className="surface-work flex flex-col gap-1 px-4 py-4 lg:px-6 lg:py-5">
      <h2 className="text-title font-bold text-text">
        سلام، <bdi>{firstName}</bdi>
      </h2>
      <p className="text-meta text-text-muted">{formatJalaliWeekdayDate()}</p>
      <p className="text-meta text-text-muted">
        <bdi>{school}</bdi>
      </p>
    </header>
  );
}
