import { cn } from "cn";
import { stampText, subjectHue } from "@/lib/subject-stamp";

// Full class strings per hue so Tailwind sees every one (no interpolated class names). The ring is the ink at 9 %
// (`/9` → color-mix(in oklab, ink 9%, transparent)).
const HUE_CLASSES = [
  "bg-subject-0-bg text-subject-0-ink ring-subject-0-ink/9",
  "bg-subject-1-bg text-subject-1-ink ring-subject-1-ink/9",
  "bg-subject-2-bg text-subject-2-ink ring-subject-2-ink/9",
  "bg-subject-3-bg text-subject-3-ink ring-subject-3-ink/9",
  "bg-subject-4-bg text-subject-4-ink ring-subject-4-ink/9",
  "bg-subject-5-bg text-subject-5-ink ring-subject-5-ink/9",
  "bg-subject-6-bg text-subject-6-ink ring-subject-6-ink/9",
  "bg-subject-7-bg text-subject-7-ink ring-subject-7-ink/9",
] as const;

/**
 * «مُهر درس» — the subject stamp: the first letters of the درس name (src/lib/subject-stamp `stampText`) in bold ink
 * on one of eight muted subject hues, picked from the subject id so a درس has the same colour everywhere. It
 * replaces the row glyph on rows that belong to a subject (homework rows, the subject page header); rows without a
 * subject keep `RowMark`. 36 px / radius 10 in lists, `lg` 48 px / radius 13 for the subject page header.
 * Decorative (`aria-hidden`): the subject name is always in the text beside it.
 */
export function SubjectStamp({ subjectId, name, size = "md", className }: { subjectId: string; name: string; size?: "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center pt-px font-bold leading-none whitespace-nowrap ring-1 ring-inset",
        size === "lg" ? "size-12 rounded-[13px] text-base leading-none" : "size-9 rounded-[10px] text-meta leading-none",
        HUE_CLASSES[subjectHue(subjectId)],
        className,
      )}
      aria-hidden
    >
      {stampText(name)}
    </span>
  );
}
