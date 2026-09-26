// «مُهر درس» (src/lib/subject-stamp): the abbreviation of the 26 subject names on the owner-approved swatch page,
// the normalisation it applies, and the colour index — stable per id, 0–7, and spread over all eight hues.
import { describe, expect, it } from "vitest";
import { SUBJECT_HUES, fnv1a, stampText, subjectHue } from "@/lib/subject-stamp";

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
