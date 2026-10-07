import { useId } from "react";
import { cn } from "@/lib/cn";
import { subjectArt } from "@/lib/subject-icon";
import { C, type GradientKey, SUBJECT_ART_DRAWINGS } from "./subject-arts";

/**
 * The illustration at the END of the subject page's hero card (mock class-page-v3) — «هر درس تصویر خودش» (owner
 * 2026-10-07): the drawing is picked from the درس NAME by the same keyword table as its glyph (`subjectArt` in
 * src/lib/subject-icon.ts), so «هندسه ۲» and «ریاضی ۱» share «کتاب، ماشین‌حساب و گونیا» and an unknown name gets the
 * stacked books. The frame draws what every art shares — the soft blob, the ground shadow and the gradients, with ids
 * from `useId` so two heroes on one page never clash; the objects are in ./subject-arts.tsx. No subject hue here:
 * the hue belongs to the stamp beside it. Decorative (`aria-hidden`): the درس name is printed next to it. Sized by
 * the caller's `className` (the board is 160×130, fitted inside the box).
 */
export function SubjectHeroArt(props: { subjectName: string; subjectId: string; className?: string }) {
  const pre = useId();
  const key = subjectArt(props.subjectName);
  const u = (k: GradientKey) => `url(#${pre}-${k})`;
  return (
    <span className={cn("pointer-events-none block shrink-0", props.className)} aria-hidden data-art={key}>
      <svg viewBox="0 0 160 130" className="size-full" focusable="false">
        <defs>
          <linearGradient id={`${pre}-b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.p400} />
            <stop offset="1" stopColor={C.p600} />
          </linearGradient>
          <linearGradient id={`${pre}-d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.p700} />
            <stop offset="1" stopColor={C.p900} />
          </linearGradient>
          <linearGradient id={`${pre}-s`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.info} />
            <stop offset="1" stopColor={C.sky} />
          </linearGradient>
          <linearGradient id={`${pre}-y`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.warnSoft} />
            <stop offset=".45" stopColor={C.warn} />
          </linearGradient>
          <linearGradient id={`${pre}-i`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.white} />
            <stop offset="1" stopColor={C.infoSoft} />
          </linearGradient>
          <radialGradient id={`${pre}-hl`} cx=".3" cy=".2" r=".8">
            <stop offset="0" stopColor={C.white} stopOpacity=".5" />
            <stop offset="1" stopColor={C.white} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${pre}-blob`} cx=".5" cy=".55" r=".55">
            <stop offset="0" stopColor={C.p100} />
            <stop offset="1" stopColor={C.p100} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="82" cy="72" rx="76" ry="56" fill={`url(#${pre}-blob)`} />
        <ellipse cx="80" cy="118" rx="58" ry="7" fill={C.ink} opacity=".08" />
        {SUBJECT_ART_DRAWINGS[key](u, pre)}
      </svg>
    </span>
  );
}
