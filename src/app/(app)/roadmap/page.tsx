import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "آنچه در راه است | سامانهٴ مدرسه" };

/** Placeholder for phase 1 — the content arrives in a later block. */
export default function Page() {
  return (
    <div className="px-4 pt-5 md:pt-8">
      <h2 className="text-xl font-bold text-text">آنچه در راه است</h2>
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
