// «کارنامهٴ توصیفی» — the converter of the school's objective documents (scripts/primary-objectives-parse.ts): every
// domain-tag form the six documents use, every month-heading spelling, the درس-name mapping, the orthography rules,
// the hand-made fixes, and that the committed scripts/data/primary-objectives.json is exactly what a fresh parse of
// the committed source gives (so nobody edits the JSON by hand), with a snapshot of the counts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderJson, renderReview } from "../../scripts/build-primary-objectives";
import { classifyHeading, countObjectives, extractDomain, isJunk, normalizeChars, orthography, parseObjectivesText, tagShape } from "../../scripts/primary-objectives-parse";
import { canonicalSubject, PRIMARY_SUBJECTS, SCHOOL_MONTHS } from "@/modules/academic/primary-objectives";

const ROOT = resolve(__dirname, "../..");
const SOURCE = readFileSync(resolve(ROOT, "scripts/data/primary-objectives-source.txt"), "utf8");
const COMMITTED = readFileSync(resolve(ROOT, "scripts/data/primary-objectives.json"), "utf8");
const ZWNJ = "‌";

describe("normalizeChars / isJunk", () => {
  it("drops zero-width marks, folds Arabic letters, turns NBSP/tabs into spaces and tidies ZWNJ", () => {
    expect(normalizeChars("​سوره‌ی کوثر را می‌خواند.")).toBe(`سوره${ZWNJ}ی کوثر را می${ZWNJ}خواند.`);
    expect(normalizeChars("فعاليت هاي كلاس")).toBe("فعالیت های کلاس");
    expect(normalizeChars("روان خوانی\tمی کند   ")).toBe("روان خوانی می کند");
    expect(normalizeChars(`صامت خوانی را انجام می دهد.          ${ZWNJ}`)).toBe("صامت خوانی را انجام می دهد.");
    expect(normalizeChars(`آیات ${ZWNJ} را`)).toBe("آیات را");
  });

  it("treats separators and dot runs as junk, never a line with a letter", () => {
    for (const s of ["...", ".", "......................", "………………", "------------------------------------------------------------", "", "—"]) expect(isJunk(s)).toBe(true);
    expect(isJunk("دی")).toBe(false);
    expect(isJunk("۲۰۰")).toBe(false);
  });
});

describe("extractDomain — every tag form of the six documents", () => {
  const cases: Array<[string, string, "knowledge" | "application" | "reasoning"]> = [
    ["الگوهای ساده راتشخیص می دهد.----دانشی", "الگوهای ساده راتشخیص می دهد", "knowledge"],
    ["مفهوم مجموعه های یک تا پنج تایی را می داند.---دانشی", "مفهوم مجموعه های یک تا پنج تایی را می داند", "knowledge"],
    ["مفهوم سطر و ستون را می شناسدت--- دانشی", "مفهوم سطر و ستون را می شناسدت", "knowledge"],
    ["با استفاده از شابلون شکل های هندسی رسم می کند-- کاربردی.", "با استفاده از شابلون شکل های هندسی رسم می کند", "application"],
    ["جدول سودو کوی چهارخانه را با توجه به الگو کامل می کند.—استدلالی", "جدول سودو کوی چهارخانه را با توجه به الگو کامل می کند", "reasoning"],
    ["مفهوم شادابی و سلامت بدن را توضیح می دهد==دانشی", "مفهوم شادابی و سلامت بدن را توضیح می دهد", "knowledge"],
    ["مفهوم گوشه و لبه را می‌داند. (دانشی)", "مفهوم گوشه و لبه را می‌داند", "knowledge"],
    ["در هنگام بازدید و گردش علمی یادداشت برداری می کند .( کاربردی)", "در هنگام بازدید و گردش علمی یادداشت برداری می کند", "application"],
    ["توانایی حل مسئله و تشخیص راه حل و جلو نویسی مسائل را دارد .(استدلالی", "توانایی حل مسئله و تشخیص راه حل و جلو نویسی مسائل را دارد", "reasoning"],
    ["با چگونگی پیدایش شب و روز آشناست .(استدلال)", "با چگونگی پیدایش شب و روز آشناست", "reasoning"],
    ["تحقیق و گزارش کارهای خود را به موقع به آموزگار تحویل می دهد.---گاربردی", "تحقیق و گزارش کارهای خود را به موقع به آموزگار تحویل می دهد", "application"],
    ["مهارت دسته بندی اشیا را دارد .---کاربرد", "مهارت دسته بندی اشیا را دارد", "application"],
    ["مهارت حل مسائل جمع و تفریق به کمک حدس و آزمایش را داراست .===استدلالی", "مهارت حل مسائل جمع و تفریق به کمک حدس و آزمایش را داراست", "reasoning"],
    ["مفهوم تقارن و الگوهای متقارن را می‌داند — دانشی", "مفهوم تقارن و الگوهای متقارن را می‌داند", "knowledge"],
    ["الگوهای عددی را شناسایی و ادامه می‌دهد. ــ دانشی", "الگوهای عددی را شناسایی و ادامه می‌دهد", "knowledge"],
    ["ویژگی‌های چندضلعی‌ها را بیان می‌کند. دانشی", "ویژگی‌های چندضلعی‌ها را بیان می‌کند", "knowledge"],
    ["با توجه به نوع نیرو و حرکت جسم، علت تغییر حرکت را توضیح می‌دهد. ---: استدلالی", "با توجه به نوع نیرو و حرکت جسم، علت تغییر حرکت را توضیح می‌دهد", "reasoning"],
    ["نمونه‌ای از اثر نیرو بر حرکت یک جسم را در زندگی روزمره نشان می‌دهد. کاربردی", "نمونه‌ای از اثر نیرو بر حرکت یک جسم را در زندگی روزمره نشان می‌دهد", "application"],
    ["مراحل آزمایش را با نظم و دقت انجام می‌دهد ---کاربردی", "مراحل آزمایش را با نظم و دقت انجام می‌دهد", "application"],
    ["برای مقایسه چند عدد اعشاری، راهبرد مناسب انتخاب می‌کند    استدلالی", "برای مقایسه چند عدد اعشاری، راهبرد مناسب انتخاب می‌کند", "reasoning"],
  ];
  it.each(cases)("%s", (line, text, domain) => {
    const t = extractDomain(line);
    expect(t.domain).toBe(domain);
    expect(t.text.replace(/[\s.]+$/, "")).toBe(text);
  });

  it("leaves lines without a tag alone — dashes and «ـ» inside a sentence are not tags", () => {
    for (const line of [
      "در هنگام راه رفتن و دویدن با دستور معلم در جهت‌های چپ - راست - جلو و عقب تغییر مسیر می‌دهد",
      "اهمیت فرهنگ و هنر ایرانی ـ اسلامی را بیان می‌کند.",
      "با مهارت نقشه خوانی- عکس خوانی آشنایی دارد",
      "جمع و تفریق کسرها را در یک مسئله‌ی کاربردی به کار می‌برد.",
      "آداب خواندن قرآن را رعایت می‌کند. (وضو، پاکیزگی، سکوت)",
    ]) {
      expect(extractDomain(line)).toEqual({ text: line, domain: null, form: null });
    }
  });

  it("tagShape reduces a tag to its separator for the review", () => {
    expect(tagShape(". ---- دانشی")).toBe("---دانشی");
    expect(tagShape(". ــ کاربردی")).toBe("ــکاربردی");
    expect(tagShape(".( کاربردی)")).toBe("(کاربردی)");
  });
});

describe("classifyHeading", () => {
  it("reads every month heading spelling of the documents", () => {
    const months: Array<[string, number]> = [
      ["اهداف آموزشی پایه اول دبستان ماه مهر", 7],
      ["ماه آبان", 8],
      ["آذر", 9],
      ["دی", 10],
      ["آبان ماه", 8],
      ["اهداف درسی دی ماه", 10],
      ["اهداف درسی فروردین", 1],
      ["توصیف عملکرد ماه آبان", 8],
      ["توصیف عملکرد دانش آموزان پایه چهارم — ماه آذر", 9],
      ["توصیف عملکرد دانش آموزان ماه دی", 10],
      ["توصیف عملکرد — ماه اسفند", 12],
      ["کارنامه توصیفی ماه اردیبهشت", 2],
      ["مهرماه", 7],
      ["اردیبهشت ماه", 2],
    ];
    for (const [line, month] of months) expect(classifyHeading(normalizeChars(line)), line).toEqual({ kind: "month", month });
  });

  it("reads the grade titles as titles", () => {
    expect(classifyHeading("اهداف آموزشی پایه دوم")).toEqual({ kind: "title", grade: 2 });
    expect(classifyHeading(normalizeChars("کارنامه توصیفی  پایه پنجم"))).toEqual({ kind: "title", grade: 5 });
    expect(classifyHeading("توصیف عملکرد دانش آموزان پایه ششم")).toEqual({ kind: "title", grade: 6 });
  });

  it("maps every درس heading of the documents to one canonical name", () => {
    const headings: Array<[string, string]> = [
      ["قرآن", "قرآن"],
      ["فارسی", "فارسی"],
      ["ریاضی", "ریاضی"],
      ["علوم", "علوم تجربی"],
      ["علوم تجربی", "علوم تجربی"],
      ["مطالعات", "مطالعات اجتماعی"],
      ["مطالعات اجتماعی", "مطالعات اجتماعی"],
      ["هدیه", "هدیه‌های آسمان"],
      ["هدیه ها", "هدیه‌های آسمان"],
      ["هدیه های آسمان", "هدیه‌های آسمان"],
      ["هدیه های آسمانی", "هدیه‌های آسمان"],
      ["هدیه‌های آسمان", "هدیه‌های آسمان"],
      ["تربیت بدنی", "تربیت بدنی"],
      ["هنر", "هنر"],
      ["تفکر", "تفکر و پژوهش"],
      ["فناوری", "کار و فناوری"],
      ["شایستگی", "شایستگی‌های عمومی"],
      ["شایستگی ها", "شایستگی‌های عمومی"],
      ["شایستگی عمومی", "شایستگی‌های عمومی"],
      ["شایستگی ها عمومی", "شایستگی‌های عمومی"],
      ["شایستگی های عمومی", "شایستگی‌های عمومی"],
      ["شایستگی‌های عمومی", "شایستگی‌های عمومی"],
    ];
    for (const [raw, name] of headings) {
      expect(classifyHeading(raw), raw).toEqual({ kind: "subject", name });
      expect(canonicalSubject(raw)).toBe(name);
    }
    // Every canonical name is its own alias.
    for (const s of PRIMARY_SUBJECTS) expect(canonicalSubject(s.name)).toBe(s.name);
  });

  it("does not take an objective for a heading, even when it names a month word or a درس", () => {
    for (const line of ["با زندگی حضرت موسی آشناست", "با پرنده چرخ ریسک و توانایی بافندگی لانه اش به عنوان قدرت خداوند مهربان آشناست", "با عید نوروز و مراسم های قبل و بعد از آن آشناست", "آشنایی با قرآن", "توجه به مطالعه و کتابخوانی"]) {
      expect(classifyHeading(line), line).toBeNull();
    }
  });
});

describe("orthography", () => {
  it("writes the verb prefix, plural suffix and ezafe with ZWNJ — and changes no word", () => {
    expect(orthography("نگاره ها را توضیح می دهد")).toBe(`نگاره${ZWNJ}ها را توضیح می${ZWNJ}دهد`);
    expect(orthography("ابزار ها را درست به کار نمی برد")).toBe(`ابزارها را درست به کار نمی${ZWNJ}برد`);
    expect(orthography("سوره ی توحید را می خواند")).toBe(`سوره${ZWNJ}ی توحید را می${ZWNJ}خواند`);
    expect(orthography("راههای ارتباط")).toBe(`راه${ZWNJ}های ارتباط`);
    expect(orthography("مکان هر یک شکل را با توجه به سطر وستون مشخص می کند")).toBe(`مکان هر یک شکل را با توجه به سطر و ستون مشخص می${ZWNJ}کند`);
    expect(orthography("نماز آیات وآثار آن ها را می داند")).toBe(`نماز آیات و آثار آن${ZWNJ}ها را می${ZWNJ}داند`);
    expect(orthography("با دقت به سخنان آموزگار گوش می دهد ، پیام ها را")).toBe(`با دقت به سخنان آموزگار گوش می${ZWNJ}دهد، پیام${ZWNJ}ها را`);
    expect(orthography("حرکات پایه( خم و راست شدن )را")).toBe("حرکات پایه (خم و راست شدن)را");
    expect(orthography("نحوهی عمل دستگاه تنفس را بیان میکند")).toBe(`نحوه${ZWNJ}ی عمل دستگاه تنفس را بیان می${ZWNJ}کند`);
    // Words that merely start with «و» / «می» stay as written.
    expect(orthography("وسایل ورزش و میوه")).toBe("وسایل ورزش و میوه");
    expect(orthography("(می) را می شناسد")).toBe(`(می) را می${ZWNJ}شناسد`);
  });
});

describe("parseObjectivesText — the six documents", () => {
  const { file, report } = parseObjectivesText(SOURCE);

  it("the committed JSON is exactly a fresh parse of the committed source (regenerate, never hand-edit)", () => {
    expect(renderJson(file)).toBe(COMMITTED.replace(/\r\n/g, "\n"));
  });

  it("has six grades of eight months each (مهر … اردیبهشت), in school-year order, درس‌ها in report-card order", () => {
    expect(file.grades.map((g) => g.grade)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(file.grades.map((g) => g.gradeCode)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    for (const g of file.grades) {
      expect(g.months.map((m) => m.month)).toEqual(SCHOOL_MONTHS.slice(0, 8));
      for (const m of g.months) {
        const order = m.subjects.map((s) => PRIMARY_SUBJECTS.findIndex((p) => p.name === s.name));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        for (const s of m.subjects) {
          expect(s.objectives.length).toBeGreaterThan(0);
          for (const o of s.objectives) {
            expect(o.text.length).toBeGreaterThan(5);
            expect(o.text.length).toBeLessThanOrEqual(400);
            expect(o.text).not.toMatch(/[​‍﻿]|[يك]|\s{2}|\s[.،]|\.$|^[.،]|(دانشی|کاربردی|استدلالی)$/);
          }
        }
      }
    }
  });

  it("counts per grade and the domain split (snapshot of what the school sent)", () => {
    const perGrade = Object.fromEntries(file.grades.map((g) => [g.grade, g.months.reduce((n, m) => n + m.subjects.reduce((k, s) => k + s.objectives.length, 0), 0)]));
    expect(perGrade).toEqual({ 1: 370, 2: 580, 3: 368, 4: 366, 5: 355, 6: 499 });
    const all = file.grades.flatMap((g) => g.months.flatMap((m) => m.subjects.flatMap((s) => s.objectives)));
    expect(all).toHaveLength(2538);
    const domains = { knowledge: 0, application: 0, reasoning: 0, none: 0 };
    for (const o of all) domains[o.domain ?? "none"]++;
    expect(domains).toEqual({ knowledge: 352, application: 365, reasoning: 210, none: 1611 });
    expect(countObjectives(file)).toMatchSnapshot();
  });

  it("applied each hand-made fix exactly where the review says", () => {
    const kinds = (k: string) => report.edits.filter((e) => e.kind === k);
    expect(kinds("rewrite").map((e) => [e.grade, e.line])).toEqual([[3, 1142], [3, 1212], [3, 1374], [4, 1811]]);
    expect(kinds("split").map((e) => [e.grade, e.month, e.line])).toEqual([[2, 11, 789], [2, 1, 1016]]);
    expect(kinds("move").map((e) => [e.grade, e.month, e.line])).toEqual([[3, 9, 1222], [3, 9, 1264], [5, 10, 2207], [5, 10, 2208]]);
    expect(kinds("glued-heading").map((e) => e.line)).toEqual([1713, 1775]);
    expect(kinds("duplicate").map((e) => e.line)).toEqual([1832]);
    expect(kinds("orphan").map((e) => [e.grade, e.month, e.after])).toEqual([[2, 8, "قرآن"]]);
    expect(kinds("implied-month").map((e) => [e.grade, e.after])).toEqual([[5, "مهر"]]);
    // Typos: the four «لا» extraction artefacts and the two certain ones are all there.
    const notes = new Set(kinds("typo").map((e) => e.note));
    for (const n of ["«بداشت» → «بهداشت»", "«لا» وارونه در استخراج متن: «کالس» → «کلاس»", "«لا» وارونه در استخراج متن: «عالئم» → «علائم»", "«لا» وارونه در استخراج متن: «دالیل» → «دلایل»", "«جرئیات» → «جزئیات»"]) expect(notes.has(n), n).toBe(true);
    expect(report.unsure.length).toBe(7);
  });

  it("places the moved and split objectives where they belong", () => {
    const subject = (grade: number, month: number, name: string) => file.grades[grade - 1].months.find((m) => m.month === month)!.subjects.find((s) => s.name === name)!;
    expect(subject(3, 9, "هنر").objectives[0].text).toBe("از ابزارهای مختلف به طور صحیح و با دقت استفاده می‌کند");
    expect(subject(3, 9, "تربیت بدنی").objectives[0].text.startsWith("مهارت در انجام حرکات پایه")).toBe(true);
    expect(subject(5, 10, "تربیت بدنی").objectives.map((o) => o.text)).toEqual(["مهارت‌های مربوط به طناب‌زنی را انجام می‌دهد", "در فعالیت‌های ورزشی روحیه همکاری و مسئولیت‌پذیری دارد"]);
    expect(subject(2, 8, "قرآن").objectives).toHaveLength(6);
    const farsi = subject(2, 11, "فارسی").objectives.map((o) => o.text);
    expect(farsi[0]).toBe("متن تصویری یا نوشتاری را می‌خواند و پیام آن را بیان می‌کند");
    expect(farsi[1].startsWith("با دقت به سخنان آموزگار گوش می‌دهد")).toBe(true);
    // The tag that had slipped into the middle of a sentence is the domain now.
    const sci = subject(4, 11, "علوم تجربی").objectives.at(-1)!;
    expect(sci.domain).toBe("reasoning");
    expect(sci.text.endsWith("نحوه عملکرد دستگاه گوارش را می‌داند")).toBe(true);
  });

  it("renders the review with the counts, the mapping, the tag forms and the questions for the school", () => {
    const md = renderReview(file, report);
    expect(md).toContain("۲۵۳۸ هدف");
    expect(md).toContain("| هدیه های آسمانی | هدیه‌های آسمان |");
    expect(md).toContain("`---گاربردی`");
    expect(md).toContain("## موردهای نامطمئن");
    expect(md).toContain("پایهٔ اول: خرداد");
  });
});

describe("parseObjectivesText — the structural rules on a small document", () => {
  it("assumes مهر before the first month heading, rejects an objective without a درس, and refuses a repeated month", () => {
    const doc = (body: string) => ["===== a", body, "===== b", "===== c", "===== d", "===== e", "===== f"].join("\n");
    const ok = parseObjectivesText(doc(["کارنامه توصیفی پایه اول", "قرآن", "آیات را روان می‌خواند. (دانشی)", "ماه آبان", "قرآن", "سوره را می‌خواند"].join("\n")));
    expect(ok.file.grades[0].months.map((m) => [m.month, m.subjects[0].objectives[0]])).toEqual([
      [7, { text: "آیات را روان می‌خواند", domain: "knowledge" }],
      [8, { text: "سوره را می‌خواند", domain: null }],
    ]);
    expect(ok.report.edits.some((e) => e.kind === "implied-month")).toBe(true);
    expect(() => parseObjectivesText(doc(["ماه مهر", "آیات را روان می‌خواند"].join("\n")))).toThrow(/before any درس heading/);
    expect(() => parseObjectivesText(doc(["ماه مهر", "قرآن", "الف را می‌خواند", "ماه مهر"].join("\n")))).toThrow(/appears twice/);
    expect(() => parseObjectivesText("===== a\nقرآن")).toThrow(/expected 6 documents/);
  });
});
