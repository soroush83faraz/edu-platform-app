// «مُهر درس» (src/lib/subject-stamp): the abbreviation of the 26 subject names on the owner-approved swatch page,
// the normalisation it applies, the colour index — stable per id, 0–7, and spread over all eight hues — and the
// one-or-two-line درس name of a phone timetable cell (`cellSubjectLabel`).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectStamp } from "@/components/SubjectStamp";
import { SUBJECT_HUES, cellSubjectLabel, fnv1a, stampText, subjectHue } from "@/lib/subject-stamp";

describe("stampText", () => {
  it.each([
    ["ریاضی ۱", "ریا"],
    ["فیزیک ۲", "فیز"],
    ["شیمی", "شیم"],
    ["ادبیات فارسی", "ادب"],
    ["فارسی ۱", "فار"],
    ["نگارش", "نگا"],
    ["زبان انگلیسی ۱", "انگ"],
    ["عربی، زبان قرآن ۱", "عرب"],
    ["دین و زندگی", "دین"],
    ["قرآن", "قرآن"],
    ["زیست‌شناسی", "زیس"],
    ["تاریخ معاصر", "تار"],
    ["جغرافیای ایران", "جغر"],
    ["تربیت بدنی", "ورز"],
    ["ورزش", "ورز"],
    ["هنر", "هنر"],
    ["هندسه", "هند"],
    ["حسابان", "حسا"],
    ["آمار و احتمال", "آما"],
    ["آمادگی دفاعی", "دفا"],
    ["علوم و فنون ادبی", "فنون"],
    ["تفکر و سواد رسانه‌ای", "تفکر"],
    ["کار و فناوری", "کار"],
    ["علوم تجربی", "علو"],
    ["مطالعات اجتماعی", "مطا"],
    ["فلسفه", "فلس"],
  ])("%s → %s", (name, abbr) => {
    expect(stampText(name)).toBe(abbr);
  });

  it("normalises Arabic ي / ك and strips harakat", () => {
    expect(stampText("رياضي")).toBe("ریا");
    expect(stampText("كار و فناوری")).toBe("کار");
    expect(stampText("عَرَبی")).toBe("عرب");
  });

  it("splits on ZWNJ, digits and punctuation; a lone «زبان» stays", () => {
    expect(stampText("زیست‌شناسی")).toBe("زیس");
    expect(stampText("  ۱۲ فیزیک")).toBe("فیز");
    expect(stampText("زبان")).toBe("زبا");
    expect(stampText("")).toBe("");
  });
});

describe("cellSubjectLabel", () => {
  const Z = "‌";
  it.each<[string, string[]]>([
    // One word: the whole word, never the stamp's letters.
    ["ریاضی", ["ریاضی"]],
    ["فیزیک", ["فیزیک"]],
    ["شیمی", ["شیمی"]],
    ["عربی", ["عربی"]],
    ["تاریخ", ["تاریخ"]],
    ["هندسه", ["هندسه"]],
    ["قرآن", ["قرآن"]],
    // A trailing book number is dropped (the class / details card carry it).
    ["ریاضی ۱", ["ریاضی"]],
    ["فیزیک 2", ["فیزیک"]],
    // Two words that do not share a line: one per line — «زبان» never stands alone.
    ["ادبیات فارسی", ["ادبیات", "فارسی"]],
    ["زبان انگلیسی", ["زبان", "انگلیسی"]],
    ["زبان انگلیسی ۱", ["زبان", "انگلیسی"]],
    ["علوم تجربی", ["علوم", "تجربی"]],
    ["تربیت بدنی", ["تربیت", "بدنی"]],
    ["مطالعات اجتماعی", ["مطالعات", "اجتماعی"]],
    ["جغرافیای ایران", ["جغرافیای", "ایران"]],
    [`پیام${Z}های آسمان`, [`پیام${Z}های`, "آسمان"]],
    // «و» stays with the word before it.
    ["دین و زندگی", ["دین و", "زندگی"]],
    ["کار و فناوری", ["کار و", "فناوری"]],
    ["آمار و احتمال", ["آمار و", "احتمال"]],
    // Short words share line 1.
    ["هنر ملی", ["هنر ملی"]],
    // A long ZWNJ compound breaks at the joint.
    [`زیست${Z}شناسی`, ["زیست", "شناسی"]],
    [`زیست${Z}شناسی ۲`, ["زیست", "شناسی"]],
    // A subtitle after «،» / «:» / «(» / a dash is not the name.
    ["عربی، زبان قرآن ۱", ["عربی"]],
    ["ریاضی (پایه)", ["ریاضی"]],
    ["فیزیک - آزمایشگاه", ["فیزیک"]],
    // Longer than two lines: line 2 carries the rest (the cell cuts it with an ellipsis).
    ["علوم و فنون ادبی", ["علوم و", "فنون ادبی"]],
    [`تفکر و سواد رسانه${Z}ای`, ["تفکر و", `سواد رسانه${Z}ای`]],
  ])("%s → %j", (name, lines) => {
    expect(cellSubjectLabel(name)).toEqual(lines);
  });

  it("never returns more than two lines, and normalises like the stamp", () => {
    for (const n of ["ا ب پ ت ث ج چ ح خ", "یک دو سه چهار پنج", `الف${Z}ب${Z}پ${Z}ت${Z}ث${Z}ج${Z}چ`]) {
      expect(cellSubjectLabel(n).length).toBeLessThanOrEqual(2);
    }
    expect(cellSubjectLabel("رياضي")).toEqual(["ریاضی"]);
    expect(cellSubjectLabel("  كار  و   فناوری ")).toEqual(["کار و", "فناوری"]);
    expect(cellSubjectLabel("عَرَبی")).toEqual(["عربی"]);
  });

  it("keeps a lone number or a leading «و», and an empty name is no lines", () => {
    expect(cellSubjectLabel("۱۲")).toEqual(["۱۲"]);
    expect(cellSubjectLabel("و")).toEqual(["و"]);
    expect(cellSubjectLabel("")).toEqual([]);
    expect(cellSubjectLabel("، فرعی")).toEqual([]);
  });

  it("balances a many-joint compound", () => {
    expect(cellSubjectLabel(`الفبا${Z}ب${Z}پیپیپی`)).toEqual([`الفبا${Z}ب`, "پیپیپی"]);
  });
});

describe("subjectHue", () => {
  it("is fnv1a32 of the full id, mod 8", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("abc")).toBe(440920331);
    const id = "0199a1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b";
    expect(subjectHue(id)).toBe(fnv1a(id) % 8);
    expect(subjectHue(id)).toBe(subjectHue(id));
  });

  it("spreads ids over all eight hues", () => {
    const counts = new Array<number>(SUBJECT_HUES).fill(0);
    for (let i = 0; i < 800; i++) {
      const hex = i.toString(16).padStart(12, "0");
      counts[subjectHue(`0199a1b2-7c3d-7e4f-8a5b-${hex}`)] += 1;
    }
    for (const n of counts) {
      expect(n).toBeGreaterThan(50);
      expect(n).toBeLessThan(150);
    }
  });
});

describe("SubjectStamp", () => {
  // The approved visual (36 px / r10 / 13 px, 48 px / r13 / 16 px) from theme tokens — no arbitrary values, no
  // off-scale `text-base`.
  const cls = (size: "md" | "lg") => /class="([^"]*)"/.exec(renderToStaticMarkup(createElement(SubjectStamp, { subjectId: "x", name: "ریاضی", size })))![1]!;
  it.each([
    ["md", ["size-9", "rounded-stamp", "text-meta"]],
    ["lg", ["size-12", "rounded-stamp-lg", "text-stamp"]],
  ] as const)("%s uses the stamp tokens", (size, expected) => {
    const c = cls(size).split(" ");
    for (const e of expected) expect(c).toContain(e);
    // The size role and the hue's ink colour both survive the merge (src/lib/cn knows `text-meta` is a size).
    expect(c.filter((x) => /^(bg|text)-subject-\d-(bg|ink)$/.test(x))).toHaveLength(2);
    expect(c.some((x) => x.includes("["))).toBe(false);
    expect(c).not.toContain("text-base");
  });
});
