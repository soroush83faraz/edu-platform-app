import { cn } from "@/lib/cn";
import { BookClay } from "./clay";

/**
 * The illustration slot at the END of the subject page's hero card (mock class-page-v3). ONE component on purpose:
 * the per-درس drawings («کتاب، ماشین‌حساب و گونیا» for ریاضی, …) replace only its internals — `subjectName` /
 * `subjectId` are what they will pick by. Until then every درس shows the generic open book (`BookClay`).
 * Decorative (`aria-hidden`): the درس name is printed beside it.
 */
export function SubjectHeroArt(props: { subjectName: string; subjectId: string; className?: string }) {
  return (
    <span className={cn("pointer-events-none block shrink-0", props.className)} aria-hidden>
      <BookClay size={112} className="size-full" />
    </span>
  );
}
