import Link from "next/link";
import { EmptyClay } from "@/components/illustrations";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";
import { CompactItemRow } from "./CompactItemRow";
import { Card, HomeSection } from "./HomeSection";

/** «کلاس من» + the next five open items by due date. */
export async function StudentSection({ classGroupName }: { classGroupName: string | null }) {
  const items = await homeOpenItemsQuery({ limit: 5 });
  const rows = items.ok ? items.data : [];
  return (
    <HomeSection id="student" title={classGroupName ? `کلاس من: ${classGroupName}` : "کارهای من"} more={{ href: "/inbox", label: "همهٴ کارها" }}>
      <Card>
        {rows.length === 0 ? (
          <div className="flex items-center gap-4 px-4 py-5">
            <EmptyClay size={72} />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text">کار بازی ندارید.</p>
              <p className="text-xs text-text-muted">وقتی معلم کاری بدهد، همین‌جا می‌آید.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-text-muted">{rows.length >= 5 ? "۵ کار نزدیک" : "کارهای نزدیک"}</p>
            <ul className="divide-y divide-line/70">
              {rows.map((row) => (
                <CompactItemRow key={row.id} row={row} />
              ))}
            </ul>
            <Link href="/inbox" className="flex min-h-11 items-center justify-center rounded-b-card text-sm font-medium text-sky-strong hover:bg-surface-sunken">
              همهٴ کارها
            </Link>
          </>
        )}
      </Card>
    </HomeSection>
  );
}
