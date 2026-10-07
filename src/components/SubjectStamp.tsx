import { createElement } from "react";
import { cn } from "@/lib/cn";
import { subjectIcon } from "@/lib/subject-icon";
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

// The ink alone, as a fill — the small hue swatch of the subject page's class switcher.
const SWATCH_CLASSES = [
  "bg-subject-0-ink",
  "bg-subject-1-ink",
  "bg-subject-2-ink",
  "bg-subject-3-ink",
  "bg-subject-4-ink",
  "bg-subject-5-ink",
  "bg-subject-6-ink",
  "bg-subject-7-ink",
] as const;

/** The class string of a hue index — `hue` when given (a teacher's own offering colour, `offeringHue`), else the درس's. */
function hueClasses(subjectId: string, hue?: number): string {
  return HUE_CLASSES[(((hue ?? subjectHue(subjectId)) % HUE_CLASSES.length) + HUE_CLASSES.length) % HUE_CLASSES.length];
}

/**
 * The hue classes of a درس (bg + ink + the 9 % ink ring) for a surface that wears the stamp's colour without being
 * the 36/48 px stamp — the cells of the timetable. Same key, same colour everywhere; `hue` overrides the درس's hue
 * with the teacher's own colour of that class (`teacherOfferingHues`, src/lib/subject-stamp).
 */
export function subjectHueClasses(subjectId: string, hue?: number): string {
  return hueClasses(subjectId, hue);
}

/** A 10 px square of a درس's (or a teacher's class's, `hue`) ink — names the class colour beside its name. Decorative. */
export function SubjectSwatch({ subjectId, hue, className }: { subjectId: string; hue?: number; className?: string }) {
  const i = (((hue ?? subjectHue(subjectId)) % SWATCH_CLASSES.length) + SWATCH_CLASSES.length) % SWATCH_CLASSES.length;
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", SWATCH_CLASSES[i], className)} aria-hidden />;
}

/**
 * «مُهر درس» — the subject stamp: the first letters of the درس name (src/lib/subject-stamp `stampText`) in bold ink
 * on one of eight muted subject hues, picked from the subject id so a درس has the same colour everywhere. It
 * replaces the row glyph on rows that belong to a subject but are titled by something else (homework rows); a row or
 * header whose title IS the درس name uses `SubjectIcon` below; rows without a subject keep `RowMark`. 36 px / radius 10 (`rounded-stamp`) and 13 px letters (`text-meta`) in lists, `lg` 48 px / radius 13
 * (`rounded-stamp-lg`) and 16 px letters (`text-stamp`) for a header — tokens in globals.css `@theme`.
 * Decorative (`aria-hidden`): the subject name is always in the text beside it. `hue`: a teacher's own colour of the
 * class (`offeringHue` — owner 2026-10-06: each class of a teacher its own hue); left out, the درس's hue.
 */
export function SubjectStamp({ subjectId, name, size = "md", hue, className }: { subjectId: string; name: string; size?: "md" | "lg"; hue?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center pt-px font-bold leading-none whitespace-nowrap ring-1 ring-inset",
        size === "lg" ? "size-12 rounded-stamp-lg text-stamp" : "size-9 rounded-stamp text-meta leading-none",
        hueClasses(subjectId, hue),
        className,
      )}
      aria-hidden
    >
      {stampText(name)}
    </span>
  );
}

/**
 * «نشان درس» — the درس's own glyph (src/lib/subject-icon `subjectIcon`: an atom for فیزیک, a flask for شیمی, an open
 * book for ادبیات…) in the subject's ink on its hue, in the stamp's shape: 36 px / `rounded-stamp` with a 20 px glyph
 * in lists, `lg` 48 px / `rounded-stamp-lg` with a 24 px glyph for the subject page header. For subject LISTS and
 * headers, where the full درس name is printed beside it (the stamp's letters would only repeat it), so a list of
 * درس‌ها no longer repeats one grey mark. Decorative (`aria-hidden`). `hue` as on `SubjectStamp`.
 */
export function SubjectIcon({ subjectId, name, size = "md", hue, className }: { subjectId: string; name: string; size?: "md" | "lg"; hue?: number; className?: string }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center ring-1 ring-inset", size === "lg" ? "size-12 rounded-stamp-lg" : "size-9 rounded-stamp", hueClasses(subjectId, hue), className)}
      aria-hidden
    >
      {/* A lookup of a module-level lucide component, not a component made in render (createElement keeps the
          static-components lint quiet about the variable tag). */}
      {createElement(subjectIcon(name), { className: size === "lg" ? "size-6" : "size-5", strokeWidth: 1.75, "aria-hidden": true })}
    </span>
  );
}
