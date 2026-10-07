// «هر درس تصویر خودش» (owner 2026-10-07): the subject page's hero illustration is picked from the درس name by the
// same keyword table as its glyph (`subjectArt`, src/lib/subject-icon.ts). Every درس the seeds create gets its own
// drawing (never the stacked-books fallback), unknown names fall back, and the rendered art is decorative, token-
// coloured and keeps its gradient ids per instance.
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectHeroArt } from "@/components/illustrations/SubjectHeroArt";
import { SUBJECT_ART_DRAWINGS } from "@/components/illustrations/subject-arts";
import { SUBJECT_ARTS, type SubjectArt, subjectArt } from "@/lib/subject-icon";

const Z = "‌";

describe("subjectArt", () => {
  // Every subject name in scripts/ (seed.ts, seed-pilot.ts, seed-demo-extras.ts, build-demo-workbook.ts).
  it.each<[string, SubjectArt]>([
    ["ریاضی", "math"],
    ["فیزیک", "physics"],
    ["شیمی", "chemistry"],
    [`زیست${Z}شناسی`, "biology"],
    ["علوم تجربی", "biology"],
    ["ادبیات فارسی", "literature"],
    ["عربی", "arabic"],
    ["زبان انگلیسی", "english"],
    ["زبان", "english"],
    ["دین و زندگی", "religion"],
    [`پیام${Z}های آسمان`, "religion"],
    ["مطالعات اجتماعی", "social"],
    ["تاریخ", "social"],
    ["کار و فناوری", "tech"],
    ["تربیت بدنی", "sport"],
  ])("seeded «%s» → %s", (name, art) => {
    expect(subjectArt(name)).toBe(art);
  });

  it.each<[string, SubjectArt]>([
    ["هندسه ۲", "math"],
    ["حسابان ۱", "math"],
    ["آمار و احتمال", "math"],
    ["نگارش ۲", "literature"],
    ["عربی، زبان قرآن ۱", "arabic"],
    ["قرآن", "religion"],
    ["جغرافیای ایران", "social"],
    ["رایانه", "tech"],
    ["هنر", "art"],
    ["ورزش", "sport"],
  ])("other curriculum names: «%s» → %s", (name, art) => {
    expect(subjectArt(name)).toBe(art);
  });

  it("falls back to the stacked books for a name no rule knows", () => {
    expect(subjectArt("")).toBe("generic");
    expect(subjectArt("کلاس تقویتی")).toBe("generic");
  });

  it("has a drawing for every art key", () => {
    expect(Object.keys(SUBJECT_ART_DRAWINGS).sort()).toEqual([...SUBJECT_ARTS].sort());
  });
});

describe("SubjectHeroArt", () => {
  const html = (name: string) => renderToStaticMarkup(createElement(SubjectHeroArt, { subjectName: name, subjectId: "x", className: "size-28 lg:size-36" }));

  it("is decorative, sized by the caller and tagged with its art", () => {
    const h = html("شیمی");
    expect(h).toMatch(/^<span class="[^"]*size-28 lg:size-36[^"]*" aria-hidden="true" data-art="chemistry"/);
    expect(h).not.toMatch(/<image|<text|href=/);
  });

  it.each(SUBJECT_ARTS.map((a) => [a]))("%s draws in theme tokens only (no hard-coded colours) and stays small", (art) => {
    const name = { math: "ریاضی", physics: "فیزیک", chemistry: "شیمی", biology: "علوم تجربی", literature: "ادبیات فارسی", arabic: "عربی", english: "زبان انگلیسی", religion: "دین و زندگی", social: "تاریخ", tech: "کار و فناوری", sport: "تربیت بدنی", art: "هنر", generic: "کلاس تقویتی" }[art];
    const h = html(name);
    expect(h).toContain(`data-art="${art}"`);
    const colours = [...h.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]+)"/g)].map((m) => m[1]);
    expect(colours).toEqual([]);
    expect(h.length).toBeLessThan(9000);
  });

  it("keeps gradient ids apart when two arts share a page", () => {
    const h = renderToStaticMarkup(
      createElement(Fragment, null, createElement(SubjectHeroArt, { subjectName: "فیزیک", subjectId: "a" }), createElement(SubjectHeroArt, { subjectName: "شیمی", subjectId: "b" })),
    );
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
