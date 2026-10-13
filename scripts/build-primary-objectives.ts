// «کارنامهٴ توصیفی» — turns the school's learning objectives (six Word files, extracted to text in
// scripts/data/primary-objectives-source.txt) into the committed scripts/data/primary-objectives.json that the
// catalog seed installs (scripts/objectives-catalog.ts), and writes the human review docs/primary-objectives-review.md.
// Re-runnable and deterministic: the same source always gives byte-identical outputs
// (tests/unit/primary-objectives-parse.test.ts compares the committed JSON with a fresh parse).
//
//   pnpm tsx scripts/build-primary-objectives.ts [path/to/source.txt]
//
// A new version of the documents: extract each .docx to text (paragraph order, one per line, `===== <file name>`
// before each document, grades ۱…۶ in order — python zipfile over word/document.xml is enough), replace the source
// file, run this, read the review, commit all three. The parse rules live in ./primary-objectives-parse.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMAIN_LABELS_FA, PRIMARY_GRADE_WORDS, PRIMARY_SUBJECTS, SCHOOL_MONTHS, jalaliMonthName, type PrimaryObjectivesFile } from "../src/modules/academic/primary-objectives";
import { parseObjectivesText, type EditKind, type ParseReport } from "./primary-objectives-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "scripts/data/primary-objectives-source.txt";
export const OUT_JSON = "scripts/data/primary-objectives.json";
export const OUT_REVIEW = "docs/primary-objectives-review.md";

const fa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const cell = (s: string) => s.replace(/\|/g, "\\|");

/** The JSON exactly as committed: two-space indent, LF, trailing newline. */
export function renderJson(file: PrimaryObjectivesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

const KIND_TITLES: Record<EditKind, string> = {
  typo: "غلط‌های تایپی اصلاح‌شده",
  rewrite: "سطرهایی که ترتیب کلمه‌هایشان درست شد",
  split: "سطرهایی که دو هدف داشتند و جدا شدند",
  move: "هدف‌هایی که زیر درس اشتباه آمده بودند و جابه‌جا شدند",
  "glued-heading": "عنوان درسی که به انتهای هدف چسبیده بود",
  duplicate: "هدف‌های تکراری حذف‌شده",
  orphan: "هدف‌هایی که عنوان درس نداشتند",
  "implied-month": "ماه‌هایی که عنوان نداشتند",
};

export function renderReview(file: PrimaryObjectivesFile, report: ParseReport): string {
  const out: string[] = [];
  const total = file.grades.reduce((n, g) => n + g.months.reduce((m, mo) => m + mo.subjects.reduce((k, s) => k + s.objectives.length, 0), 0), 0);
  out.push(
    "# بازبینی اهداف آموزشی دبستان (کارنامهٴ توصیفی)",
    "",
    `این فایل را \`scripts/build-primary-objectives.ts\` از \`${SOURCE}\` (متن شش فایل Word مدرسه) می‌سازد؛ دستی ویرایش نکنید. خروجی داده: \`${OUT_JSON}\` — همان چیزی که seed کاتالوگ در هر استقرار برای هر سازمان نصب می‌کند.`,
    "",
    `جمع: **${fa(total)} هدف** در ${fa(file.grades.length)} پایه.`,
    "",
  );

  // ---- counts: grade × month, then grade × month × درس ----
  out.push("## شمار هدف‌ها به تفکیک پایه و ماه", "");
  out.push(`| پایه | ${SCHOOL_MONTHS.map(jalaliMonthName).join(" | ")} | جمع |`, `|---|${SCHOOL_MONTHS.map(() => "---").join("|")}|---|`);
  for (const g of file.grades) {
    const row = SCHOOL_MONTHS.map((m) => {
      const mo = g.months.find((x) => x.month === m);
      return mo ? fa(mo.subjects.reduce((k, s) => k + s.objectives.length, 0)) : "—";
    });
    const sum = g.months.reduce((n, mo) => n + mo.subjects.reduce((k, s) => k + s.objectives.length, 0), 0);
    out.push(`| ${PRIMARY_GRADE_WORDS[g.grade - 1]} | ${row.join(" | ")} | ${fa(sum)} |`);
  }
  out.push("");

  out.push("## ماه‌های بدون هدف", "");
  for (const g of file.grades) {
    const missing = SCHOOL_MONTHS.filter((m) => !g.months.some((x) => x.month === m));
    out.push(`- پایهٔ ${PRIMARY_GRADE_WORDS[g.grade - 1]}: ${missing.length === 0 ? "هیچ" : missing.map(jalaliMonthName).join("، ")}`);
  }
  out.push("");

  out.push("## شمار هدف‌ها به تفکیک درس", "");
  for (const g of file.grades) {
    const subjects = PRIMARY_SUBJECTS.map((s) => s.name).filter((name) => g.months.some((m) => m.subjects.some((s) => s.name === name)));
    out.push(`### پایهٔ ${PRIMARY_GRADE_WORDS[g.grade - 1]}`, "");
    out.push(`| ماه | ${subjects.join(" | ")} |`, `|---|${subjects.map(() => "---").join("|")}|`);
    for (const m of g.months) {
      out.push(`| ${m.name} | ${subjects.map((name) => fa(m.subjects.find((s) => s.name === name)?.objectives.length ?? 0).replace(/^۰$/, "**۰**")).join(" | ")} |`);
    }
    out.push("");
  }
  out.push("صفر پررنگ = آن درس در آن ماه در سند مدرسه هیچ هدفی ندارد (عنوانش نیامده است).", "");

  // ---- mappings ----
  out.push("## نام درس‌ها: عنوان در سند ← نام یکسان", "");
  out.push("| عنوان در سند | نام یکسان | دفعات |", "|---|---|---|");
  for (const h of report.subjectHeadings) out.push(`| ${cell(h.raw)} | ${h.canonical} | ${fa(h.count)} |`);
  out.push("");

  out.push("## عنوان ماه‌ها (همان‌طور که نوشته شده‌اند)", "");
  out.push("| پایه | سطر | عنوان | ماه |", "|---|---|---|---|");
  for (const m of report.monthHeadings) out.push(`| ${PRIMARY_GRADE_WORDS[m.grade - 1]} | ${fa(m.line)} | ${cell(m.raw)} | ${jalaliMonthName(m.month)} |`);
  out.push("");

  out.push("## برچسب حیطه: شکل‌های نوشته‌شده", "");
  out.push("برچسب از انتهای هدف برداشته و در ستون «حیطه» ذخیره شد (دانشی → `knowledge`، کاربردی → `application`، استدلالی → `reasoning`؛ بی‌برچسب = خالی).", "");
  out.push("| شکل در سند | حیطه | دفعات |", "|---|---|---|");
  for (const t of report.tagForms) out.push(`| \`${cell(t.form)}\` | ${DOMAIN_LABELS_FA[t.domain]} | ${fa(t.count)} |`);
  out.push("");

  // ---- edits ----
  out.push("## تغییرهای متن", "");
  out.push(
    `یکسان‌سازی نگارشی (بدون تغییر کلمه، روی ${fa(report.orthographyTouched)} هدف): ی/ک عربی → فارسی؛ حذف نویسه‌های نامرئی؛ «می کند» → «می‌کند»؛ «نشانه ها» → «نشانه‌ها»؛ «سوره ی» → «سوره‌ی»؛ «ودر» → «و در» (فقط ${fa(24)} واژهٔ بررسی‌شده)؛ فاصله پیش از «،» و «.» و درون پرانتز؛ نقطهٔ پایان جمله و نقطه‌چین‌ها؛ نقطهٔ ابتدای سطر (اثر جهت راست‌به‌چپ در Word). سطرهای خالی، نقطه‌چین و جداکننده (${fa(report.skipped)} سطر همراه با عنوان پایه‌ها) نادیده گرفته شدند.`,
    "",
  );
  const kinds: EditKind[] = ["typo", "rewrite", "split", "move", "glued-heading", "duplicate", "orphan", "implied-month"];
  for (const kind of kinds) {
    const list = report.edits.filter((e) => e.kind === kind);
    if (list.length === 0) continue;
    out.push(`### ${KIND_TITLES[kind]} (${fa(list.length)})`, "");
    if (kind === "typo") {
      // One row per fix: how often, where, and the first occurrence as the example.
      const byNote = new Map<string, typeof list>();
      for (const e of list) byNote.set(e.note, [...(byNote.get(e.note) ?? []), e]);
      out.push("| اصلاح | دفعات | سطرها | نمونه (پیش ← پس) |", "|---|---|---|---|");
      for (const [note, es] of byNote) {
        out.push(`| ${cell(note)} | ${fa(es.length)} | ${es.map((e) => fa(e.line)).join("، ")} | «${cell(es[0].before)}» ← «${cell(es[0].after)}» |`);
      }
      out.push("");
      continue;
    }
    out.push("| پایه | ماه | درس | سطر | پیش | پس | توضیح |", "|---|---|---|---|---|---|---|");
    for (const e of list) {
      out.push(`| ${PRIMARY_GRADE_WORDS[e.grade - 1]} | ${e.month ? jalaliMonthName(e.month) : "—"} | ${e.subject ?? "—"} | ${fa(e.line)} | ${cell(e.before) || "—"} | ${cell(e.after) || "—"} | ${cell(e.note)} |`);
    }
    out.push("");
  }

  // ---- for the school to confirm ----
  out.push("## موردهای نامطمئن (برای تأیید مدرسه)", "");
  const unsureEdits = report.edits.filter((e) => e.unsure);
  for (const e of unsureEdits) {
    out.push(`- پایهٔ ${PRIMARY_GRADE_WORDS[e.grade - 1]}، ${e.month ? jalaliMonthName(e.month) : "—"}، ${e.subject ?? "—"} (سطر ${fa(e.line)}): «${e.before}» ← «${e.after}» — ${e.note}`);
  }
  for (const u of report.unsure) {
    out.push(`- پایهٔ ${PRIMARY_GRADE_WORDS[u.grade - 1]}، ${jalaliMonthName(u.month)}، ${u.subject} (سطر ${fa(u.line)}): «${u.text}» — دست نخورد؛ ${u.note}`);
  }
  out.push("");
  return out.join("\n");
}

function main(): void {
  const sourcePath = resolve(ROOT, process.argv[2] ?? SOURCE);
  const { file, report } = parseObjectivesText(readFileSync(sourcePath, "utf8"));
  writeFileSync(resolve(ROOT, OUT_JSON), renderJson(file), "utf8");
  writeFileSync(resolve(ROOT, OUT_REVIEW), renderReview(file, report), "utf8");
  const total = file.grades.reduce((n, g) => n + g.months.reduce((m, mo) => m + mo.subjects.reduce((k, s) => k + s.objectives.length, 0), 0), 0);
  console.log(`primary objectives: ${total} objectives, ${report.edits.length} edits (${report.edits.filter((e) => e.unsure).length + report.unsure.length} to confirm) → ${OUT_JSON}, ${OUT_REVIEW}`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
