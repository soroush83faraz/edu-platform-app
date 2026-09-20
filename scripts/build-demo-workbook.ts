// Fills the import template with the DANESH demo data of scripts/seed.ts (school G: 13 students, 2 teachers,
// 3 classes) → template/demo-danesh.xlsx. Used by the import idempotency test and for manual CLI runs:
//   pnpm tsx scripts/build-demo-workbook.ts [out.xlsx]
//   pnpm tsx scripts/import.ts template/demo-danesh.xlsx --org danesh-demo --school G --as 09123000002 --dry-run
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeTemplate, type ExampleRows } from "./build-template";
import { DANESH, demoPhone } from "./seed";

/** The workbook rows, derived from the seed spec so both stay in step. */
export function demoWorkbookRows(): ExampleRows {
  const students = DANESH.persons.filter((p) => p.kind === "student");
  const karimi = DANESH.persons.findIndex((p) => p.key === "karimi");
  const karimiPhone = demoPhone(1 + karimi).replace("+98", "0");
  const newTeacherPhone = "09123334455";
  return {
    classes: [
      { grade: "دهم", class_name: "۱۰/۱", branch: "" },
      { grade: "دهم", class_name: "۱۰/۲", branch: "" },
      { grade: "دهم", class_name: "۱۰/۴", branch: "" },
    ],
    students: students.map((p) => {
      const i = DANESH.persons.indexOf(p);
      return {
        first_name: p.firstName,
        last_name: p.lastName,
        student_number: p.studentNumber!,
        phone: demoPhone(1 + i).replace("+98", "0"),
        guardian_phone: "",
        grade: "دهم",
        class_name: "۱۰/۲",
        external_ref: "",
      };
    }),
    staff: [
      { first_name: "علی", last_name: "کریمی", phone: karimiPhone, employee_number: "" },
      { first_name: "حسین", last_name: "محمدی", phone: newTeacherPhone, employee_number: "1001" },
    ],
    teaching: [
      { teacher_phone: karimiPhone, teacher_name: "علی کریمی", class_name: "۱۰/۱", subject: "ریاضی" },
      { teacher_phone: karimiPhone, teacher_name: "علی کریمی", class_name: "۱۰/۲", subject: "ریاضی" },
      { teacher_phone: newTeacherPhone, teacher_name: "حسین محمدی", class_name: "۱۰/۱", subject: "فیزیک" },
      { teacher_phone: newTeacherPhone, teacher_name: "حسین محمدی", class_name: "۱۰/۴", subject: "ریاضی" },
    ],
  };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2] ?? path.resolve(process.cwd(), "template", "demo-danesh.xlsx");
  writeTemplate(out, demoWorkbookRows())
    .then(() => {
      console.log(`[build-demo-workbook] wrote ${out}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("[build-demo-workbook] FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
