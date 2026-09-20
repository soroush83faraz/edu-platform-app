// Excel → rows. `.xlsx` only (exceljs). Sheets are matched by name (Persian, alias or key), columns by the hidden
// English key row when present, else by Persian header aliases. Every cell becomes a trimmed string with ASCII
// digits and normalized Persian letters; phone columns go through `normalizePhoneIR` (a number cell that lost
// its leading 0 — `9121234567` — is still a valid phone). Empty rows are skipped. Nothing here touches the DB.
import ExcelJS from "exceljs";
import { normalizeFa, normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";
import { SHEETS, findColumn, findSheet, type ColumnDef, type SheetDef, type SheetKey } from "./template";

export interface Row {
  sheet: SheetKey;
  /** 1-based Excel row number (as the school sees it). */
  rowNumber: number;
  /** Raw cell texts by column key (before phone normalization). */
  raw: Record<string, string>;
  /** Normalized values by column key; a phone that failed normalization keeps its raw text and is reported in `errors`. */
  values: Record<string, string>;
}

export interface RowError {
  sheet: SheetKey | null;
  rowNumber: number | null;
  column: string | null;
  message: string;
  /** `warning` never blocks a commit (missing optional sheet, ignored header). */
  level: "error" | "warning";
}

export interface ParsedWorkbook {
  sheets: Record<SheetKey, Row[]>;
  /** Structural problems: missing sheets/columns, unknown headers, bad phones. */
  errors: RowError[];
  /** Sheets found in the file that map to no template sheet (ignored, reported as warnings). */
  ignoredSheets: string[];
}

export class ImportFileError extends Error {}

/** One cell → text: exceljs `.text` (formatted), rich text flattened, numbers without scientific notation. */
export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 });
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("result" in v && v.result !== undefined && v.result !== null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return cell.text ?? String(v);
}

/** Trim + Persian letters. Digits stay as typed (class names like «۱۰/۱» keep their look); `digits`/`phone` columns convert. */
export function normalizeCell(text: string): string {
  return normalizeFa(text).trim();
}

/**
 * Phone from an Excel cell: `09121234567`, `9121234567` (leading 0 lost when Excel stored a number),
 * `+989121234567`, Persian digits, spaces/dashes. Null when not a valid Iranian mobile.
 */
export function phoneFromCell(text: string): string | null {
  const ascii = toAsciiDigits(text).replace(/[\s\-().]/g, "");
  if (!ascii) return null;
  return normalizePhoneIR(ascii) ?? normalizePhoneIR(`0${ascii}`);
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

interface HeaderMap {
  /** column index (1-based) → column def */
  columns: Map<number, ColumnDef>;
  /** first data row (1-based) */
  firstDataRow: number;
  unknownHeaders: string[];
}

function mapHeaders(ws: ExcelJS.Worksheet, def: SheetDef): HeaderMap {
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const columns = new Map<number, ColumnDef>();
  const unknownHeaders: string[] = [];
  // Hidden key row: every non-empty cell of row 2 is an English identifier → authoritative.
  const row2Texts: string[] = [];
  row2.eachCell({ includeEmpty: false }, (c) => row2Texts.push(cellText(c).trim()));
  const hasKeyRow = row2Texts.length > 0 && row2Texts.every((t) => KEY_RE.test(t));
  if (hasKeyRow) {
    row2.eachCell({ includeEmpty: false }, (c, col) => {
      const key = cellText(c).trim();
      const cd = def.columns.find((x) => x.key === key);
      if (cd) columns.set(col, cd);
      else unknownHeaders.push(key);
    });
    return { columns, firstDataRow: 3, unknownHeaders };
  }
  row1.eachCell({ includeEmpty: false }, (c, col) => {
    const header = cellText(c).trim();
    const cd = findColumn(def, header);
    if (cd) columns.set(col, cd);
    else unknownHeaders.push(header);
  });
  return { columns, firstDataRow: 2, unknownHeaders };
}

export async function parseWorkbook(buffer: Buffer | ArrayBuffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportFileError("فایل باید اکسل با فرمت .xlsx باشد.");
  }
  const sheets: Record<SheetKey, Row[]> = { classes: [], students: [], staff: [], teaching: [] };
  const errors: RowError[] = [];
  const ignoredSheets: string[] = [];
  const seen = new Set<SheetKey>();

  for (const ws of wb.worksheets) {
    const def = findSheet(ws.name);
    if (!def) {
      if (ws.name.trim() !== "راهنما") ignoredSheets.push(ws.name);
      continue;
    }
    if (seen.has(def.key)) {
      errors.push({ sheet: def.key, rowNumber: null, column: null, message: `شیت «${def.nameFa}» بیش از یک‌بار در فایل هست.`, level: "error" });
      continue;
    }
    seen.add(def.key);
    const map = mapHeaders(ws, def);
    const present = [...map.columns.values()];
    for (const c of def.columns) {
      if (c.required && !present.includes(c)) {
        const covered = c.requiredUnless?.some((k) => present.some((p) => p.key === k)) ?? false;
        errors.push({
          sheet: def.key,
          rowNumber: 1,
          column: c.key,
          message: covered ? `ستون «${c.labelFa}» در شیت «${def.nameFa}» نیست؛ دبیر با نام پیدا می‌شود.` : `ستون «${c.labelFa}» در شیت «${def.nameFa}» پیدا نشد.`,
          level: covered ? "warning" : "error",
        });
      }
    }
    for (const h of map.unknownHeaders) errors.push({ sheet: def.key, rowNumber: 1, column: null, message: `ستون ناشناختهٴ «${h}» در شیت «${def.nameFa}» نادیده گرفته شد.`, level: "warning" });

    for (let r = map.firstDataRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const raw: Record<string, string> = {};
      const values: Record<string, string> = {};
      let empty = true;
      for (const [col, cd] of map.columns) {
        const text = cellText(row.getCell(col));
        if (text.trim() !== "") empty = false;
        raw[cd.key] = text;
        let v = normalizeCell(text);
        if (cd.digits) v = toAsciiDigits(v).replace(/\s+/g, "");
        if (cd.phone && v !== "") {
          const phone = phoneFromCell(v);
          if (phone) v = phone;
          else errors.push({ sheet: def.key, rowNumber: r, column: cd.key, message: `شمارهٴ موبایل «${text.trim()}» معتبر نیست (ستون «${cd.labelFa}»).`, level: "error" });
        }
        values[cd.key] = v;
      }
      if (empty) continue;
      sheets[def.key].push({ sheet: def.key, rowNumber: r, raw, values });
    }
  }
  for (const def of SHEETS) {
    if (!seen.has(def.key)) errors.push({ sheet: def.key, rowNumber: null, column: null, message: `شیت «${def.nameFa}» در فایل نیست؛ این بخش وارد نمی‌شود.`, level: "warning" });
  }
  return { sheets, errors, ignoredSheets };
}
