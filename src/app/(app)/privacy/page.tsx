import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "حریم خصوصی | سامانهٴ مدرسه" };

/** Placeholder for phase 1 — the content arrives in a later block. */
export default function Page() {
  return (
    <div className="px-4 pt-5 md:pt-8">
      <h2 className="text-xl font-bold text-text">حریم خصوصی</h2>
      <EmptyState
        title="به‌زودی"
        description="این بخش در حال آماده‌سازی است."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/more">بازگشت</Link>
          </Button>
        }
      />
    </div>
  );
}
