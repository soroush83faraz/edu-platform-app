// Builds the Excel import template (v1) from src/modules/integ/importers/template.ts:
//   pnpm tsx scripts/build-template.ts [out.xlsx]      → template/edu-import-template-v1.xlsx
// Sheets: کلاس‌ها، دانش‌آموزان، دبیران، دبیر-کلاس-درس، راهنما. Row 1 = bold Persian headers, hidden row 2 = English
// keys (the parser reads them), phone columns formatted as text (`@`) so Excel keeps the leading 0, three example
// rows, frozen header, RTL sheets. The guide sheet lists every column with its hint. Commit the output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { GUIDE_SHEET_NAME, SHEETS, TEMPLATE_VERSION, type SheetDef } from "../src/modules/integ/importers/template";

export interface ExampleRows {
  /** Per sheet key: data rows (by column key). Defaults to the template's example values. */
  [sheetKey: string]: Array<Record<string, string>>;
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1FB" } };

function addSheet(wb: ExcelJS.Workbook, def: SheetDef, rows: Array<Record<string, string>>, hideKeyRow: boolean): void {
  const ws = wb.addWorksheet(def.nameFa, { views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }] });
  const columns = def.columns.filter((c) => !c.templateHidden);
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width ?? 16 }));
  const header = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.required ? c.labelFa : `${c.labelFa} (اختیاری)`;
    cell.font = { bold: true, name: "Vazirmatn", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFC3C9D6" } } };
    if (c.hintFa) cell.note = c.hintFa;
  });
  header.height = 22;
  const keys = ws.getRow(2);
  columns.forEach((c, i) => {
    keys.getCell(i + 1).value = c.key;
    keys.getCell(i + 1).font = { color: { argb: "FF99A1B3" }, size: 8 };
  });
  keys.hidden = hideKeyRow;
  rows.forEach((r, ri) => {
    const row = ws.getRow(3 + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key] ?? "";
      if (c.phone || c.digits) cell.numFmt = "@";
      cell.alignment = { horizontal: c.phone || c.digits ? "left" : "right", readingOrder: c.phone || c.digits ? "ltr" : "rtl" };
    });
  });
  // Text format for the whole phone/number columns so pasted numbers keep their leading zero.
  columns.forEach((c, i) => {
    if (c.phone || c.digits) ws.getColumn(i + 1).numFmt = "@";
  });
}

function addGuide(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet(GUIDE_SHEET_NAME, { views: [{ rightToLeft: true }] });
  ws.columns = [{ width: 22 }, { width: 26 }, { width: 12 }, { width: 70 }];
  const title = ws.addRow([`قالب ورود اطلاعات — نسخهٴ ${TEMPLATE_VERSION}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const line of [
    "فقط داخل ستون‌های مشخص‌شده بنویسید و ساختار شیت‌ها را تغییر ندهید. ردیف دوم (کلیدهای انگلیسی) مخفی است؛ آن را حذف نکنید.",
    "شمارهٴ موبایل را با صفر اول بنویسید (مثل ۰۹۱۲۱۲۳۴۵۶۷)؛ ارقام فارسی یا انگلیسی فرقی ندارد. سلول‌ها به‌صورت متن تنظیم شده‌اند.",
    "کد ملی جمع‌آوری نمی‌شود. ردیف خالی وسط جدول نگذارید. فایل باید .xlsx باشد.",
    "نام پایه و درس باید دقیقاً همان نام سامانه باشد؛ فهرست آن‌ها را از مدیر سامانه بگیرید.",
    "ردیف‌های نمونه (سه ردیف اول هر شیت) را پاک کنید یا با دادهٴ واقعی جایگزین کنید.",
  ]) {
    const r = ws.addRow([line]);
    ws.mergeCells(r.number, 1, r.number, 4);
    r.getCell(1).alignment = { wrapText: true, readingOrder: "rtl" };
  }
  ws.addRow([]);
  for (const def of SHEETS) {
    const h = ws.addRow([`شیت «${def.nameFa}»`, def.descriptionFa]);
    ws.mergeCells(h.number, 2, h.number, 4);
    h.font = { bold: true };
    h.getCell(2).alignment = { wrapText: true, readingOrder: "rtl" };
    const th = ws.addRow(["ستون", "کلید", "الزامی", "توضیح و مثال"]);
    th.font = { bold: true, color: { argb: "FF6F788D" } };
    for (const c of def.columns.filter((x) => !x.templateHidden)) {
      const r = ws.addRow([c.labelFa, c.key, c.required ? "بله" : "خیر", `${c.hintFa}${c.hintFa ? " — " : ""}مثال: ${c.example.filter(Boolean).join("، ") || "—"}`]);
      r.getCell(4).alignment = { wrapText: true, readingOrder: "rtl" };
    }
    ws.addRow([]);
  }
}

export function buildTemplateWorkbook(examples?: ExampleRows, opts: { hideKeyRow?: boolean } = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "edu-platform";
  wb.created = new Date("2026-09-20T00:00:00Z");
  for (const def of SHEETS) {
    const rows =
      examples?.[def.key] ??
      def.columns[0].example.map((_, i) => Object.fromEntries(def.columns.filter((c) => !c.templateHidden).map((c) => [c.key, c.example[i] ?? ""])));
    addSheet(wb, def, rows, opts.hideKeyRow ?? true);
  }
  addGuide(wb);
  return wb;
}

export async function writeTemplate(outPath: string, examples?: ExampleRows): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const wb = buildTemplateWorkbook(examples);
  await wb.xlsx.writeFile(outPath);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2] ?? path.resolve(process.cwd(), "template", `edu-import-template-${TEMPLATE_VERSION}.xlsx`);
  writeTemplate(out)
    .then(() => {
      console.log(`[build-template] wrote ${out}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("[build-template] FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
