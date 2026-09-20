// Excel importer, pure parts: header/sheet alias mapping (v1 keys + v0 Persian wording), phone cells that lost
// their leading zero, Persian/Arabic letter and digit normalization, and a workbook built in memory with v0 headers.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseWorkbook, phoneFromCell } from "@/modules/integ/importers/parse";
import { SHEET_BY_KEY, findColumn, findSheet, normalizeHeader } from "@/modules/integ/importers/template";
import { autoSubjectCode, normKey } from "@/modules/integ/importers/validate";

describe("template header mapping", () => {
  it("maps Persian labels, v0 aliases and English keys to the same column", () => {
    const students = SHEET_BY_KEY.students;
    expect(findColumn(students, "شمارهٴ دانش‌آموزی")?.key).toBe("student_number");
    expect(findColumn(students, "شماره دانش آموزی")?.key).toBe("student_number");
    expect(findColumn(students, "نام کلاس")?.key).toBe("class_name");
    expect(findColumn(students, "شمارهٴ موبایل")?.key).toBe("phone");
    expect(findColumn(students, "student_number")?.key).toBe("student_number");
    expect(findColumn(students, "ستون عجیب")).toBeNull();
    expect(findSheet("دبیر-کلاس-درس")?.key).toBe("teaching");
    expect(findSheet("دبیر کلاس درس")?.key).toBe("teaching");
    expect(findSheet("کارکنان")?.key).toBe("staff");
    expect(findSheet("راهنما")).toBeNull();
  });

  it("normalizes Arabic letters, ZWNJ and spacing in headers and keys", () => {
    expect(normalizeHeader("نام خانوادگي")).toBe(normalizeHeader("نام‌خانوادگی"));
    expect(normKey("ريــاضي")).toBe(normKey("ریاضی"));
    expect(normKey("۱۰/۱")).toBe("10/1");
    expect(autoSubjectCode("ادبیات فارسی")).toMatch(/^X-[0-9A-F]{8}$/);
    expect(autoSubjectCode("ادبيات فارسي")).toBe(autoSubjectCode("ادبیات فارسی"));
  });
});

describe("phone cells", () => {
  it("accepts the leading-zero form, the number form that lost the 0, +98 and Persian digits", () => {
    expect(phoneFromCell("09121234567")).toBe("+989121234567");
    expect(phoneFromCell("9121234567")).toBe("+989121234567");
    expect(phoneFromCell("۰۹۱۲ ۱۲۳ ۴۵۶۷")).toBe("+989121234567");
    expect(phoneFromCell("+98 912-123-4567")).toBe("+989121234567");
    expect(phoneFromCell("12345")).toBeNull();
    expect(phoneFromCell("")).toBeNull();
  });
});

describe("parseWorkbook", () => {
  it("reads a v0-style file (Persian headers only, phone stored as a number, Arabic letters, Persian digits)", async () => {
    const wb = new ExcelJS.Workbook();
    const cls = wb.addWorksheet("کلاس‌ها");
    cls.addRow(["نام مدرسه", "نام کلاس", "مقطع", "پایه", "رشته"]);
    cls.addRow(["مدرسهٴ نمونه", "۱۰/۱", "متوسطهٴ دوم", "دهم", "ریاضی"]);
    cls.addRow([]);
    const st = wb.addWorksheet("دانش‌آموزان");
    st.addRow(["نام", "نام خانوادگی", "شمارهٴ دانش‌آموزی", "نام کلاس", "شمارهٴ موبایل", "شمارهٴ ولی"]);
    st.addRow(["سارا", "كريمي", "۱۰۰۱", "۱۰/۱", 9121234567, "۰۹۱۲۷۶۵۴۳۲۱"]);
    st.addRow(["علی", "رضایی", "1002", "۱۰/۱", "", "bad-phone"]);
    const tch = wb.addWorksheet("دبیران");
    tch.addRow(["نام", "نام خانوادگی", "شمارهٴ موبایل"]);
    tch.addRow(["حسین", "محمدی", "09123334455"]);
    const teaching = wb.addWorksheet("دبیر-کلاس-درس");
    teaching.addRow(["نام دبیر", "نام خانوادگی دبیر", "نام کلاس", "درس"]);
    teaching.addRow(["حسین", "محمدی", "۱۰/۱", "ریاضی"]);
    wb.addWorksheet("راهنما").addRow(["توضیح"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const parsed = await parseWorkbook(buf);
    expect(parsed.sheets.classes).toHaveLength(1);
    expect(parsed.sheets.classes[0].values).toMatchObject({ class_name: "۱۰/۱", grade: "دهم" });
    // Unknown v0 columns are reported as warnings, not errors.
    const unknown = parsed.errors.filter((e) => e.sheet === "classes" && e.level === "warning").map((e) => e.message);
    expect(unknown.join(" ")).toContain("نام مدرسه");
    expect(parsed.sheets.students).toHaveLength(2);
    const sara = parsed.sheets.students[0].values;
    expect(sara).toMatchObject({ first_name: "سارا", last_name: "کریمی", student_number: "1001", phone: "+989121234567", guardian_phone: "+989127654321", class_name: "۱۰/۱" });
    expect(parsed.sheets.students[0].raw.phone).toBe("9121234567");
    const badPhone = parsed.errors.find((e) => e.sheet === "students" && e.rowNumber === 3 && e.column === "guardian_phone");
    expect(badPhone?.level).toBe("error");
    // A v0 file names the teacher instead of the phone: only a warning (the validator resolves the name).
    expect(parsed.errors.some((e) => e.sheet === "teaching" && e.column === "teacher_phone" && e.level === "warning")).toBe(true);
    expect(parsed.errors.some((e) => e.sheet === "teaching" && e.level === "error")).toBe(false);
    expect(parsed.sheets.teaching[0].values).toMatchObject({ teacher_name: "حسین", teacher_last_name: "محمدی", class_name: "۱۰/۱", subject: "ریاضی" });
  });

  it("rejects a non-xlsx buffer with a Persian message", async () => {
    await expect(parseWorkbook(Buffer.from("not an excel file"))).rejects.toThrow(/xlsx/);
  });
});
