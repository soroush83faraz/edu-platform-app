// The global Zod v4 error map: every issue Zod raises WITHOUT an explicit message gets a Persian sentence here, so
// no English («Too small: expected number to be >=1», «Invalid input: expected number, received string») ever
// reaches a field error. Schemas still pass their own, more specific messages (`z.string().min(1, "… را وارد کنید.")`)
// — those win. Installed once at import time; `src/lib/errors/index.ts` re-exports this module so every action,
// query and resource definition (all of which import `@/lib/errors`) has it in place before the first parse.
import { z } from "zod";
import { formatNumberFa } from "@/lib/format";

const TYPE_FA: Record<string, string> = {
  string: "متن",
  number: "عدد",
  int: "عدد صحیح",
  boolean: "بله/خیر",
  date: "تاریخ",
  array: "فهرست",
  object: "شیء",
  bigint: "عدد",
  null: "خالی",
  undefined: "خالی",
  nan: "عدد نامعتبر",
};

const SIZE_UNIT_FA: Record<string, string> = {
  string: "نویسه",
  array: "مورد",
  set: "مورد",
  file: "بایت",
};

const num = (v: number | bigint): string => formatNumberFa(Number(v));

/** Persian text for one issue; `undefined` lets Zod fall back (never happens for the codes handled below). */
export function zodIssueFa(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.input === undefined || issue.input === null || issue.input === "") return "این فیلد را وارد کنید.";
      const expected = TYPE_FA[issue.expected] ?? issue.expected;
      if (issue.expected === "int") return "مقدار باید عدد صحیح باشد.";
      if (issue.expected === "number") return "مقدار باید عدد باشد.";
      if (issue.expected === "boolean") return "مقدار باید بله یا خیر باشد.";
      return `مقدار باید ${expected} باشد.`;
    }
    case "too_small": {
      const inclusive = issue.inclusive !== false;
      const unit = SIZE_UNIT_FA[issue.origin];
      if (unit) {
        if (issue.origin === "string" && Number(issue.minimum) <= 1) return "این فیلد را وارد کنید.";
        return `دست‌کم ${num(issue.minimum)} ${unit} لازم است.`;
      }
      if (issue.origin === "date") return "تاریخ زودتر از حد مجاز است.";
      return inclusive ? `مقدار نباید کمتر از ${num(issue.minimum)} باشد.` : `مقدار باید بیشتر از ${num(issue.minimum)} باشد.`;
    }
    case "too_big": {
      const inclusive = issue.inclusive !== false;
      const unit = SIZE_UNIT_FA[issue.origin];
      if (unit) return `حداکثر ${num(issue.maximum)} ${unit} مجاز است.`;
      if (issue.origin === "date") return "تاریخ دیرتر از حد مجاز است.";
      return inclusive ? `مقدار نباید بیشتر از ${num(issue.maximum)} باشد.` : `مقدار باید کمتر از ${num(issue.maximum)} باشد.`;
    }
    case "not_multiple_of":
      return `مقدار باید مضربی از ${num(issue.divisor)} باشد.`;
    case "invalid_format":
      if (issue.format === "uuid" || issue.format === "guid") return "شناسه نامعتبر است.";
      if (issue.format === "email") return "نشانی ایمیل نامعتبر است.";
      if (issue.format === "url") return "نشانی وب نامعتبر است.";
      return "قالب مقدار نامعتبر است.";
    case "invalid_value":
      return "گزینهٴ انتخاب‌شده معتبر نیست.";
    case "unrecognized_keys":
      return "فیلد ناشناخته در ورودی.";
    case "invalid_union":
      return "ورودی با هیچ‌یک از شکل‌های مجاز نمی‌خواند.";
    case "invalid_key":
    case "invalid_element":
      return "یکی از مقادیر نامعتبر است.";
    case "custom":
      return "اطلاعات واردشده معتبر نیست.";
    default:
      return "اطلاعات واردشده معتبر نیست.";
  }
}

/** Idempotent: installs `zodIssueFa` as Zod's global `customError` (specific per-schema messages still win). */
export function installZodFa(): void {
  const current = z.config();
  if (current.customError === zodErrorMap) return;
  z.config({ customError: zodErrorMap });
}

const zodErrorMap: z.core.$ZodErrorMap = (issue) => zodIssueFa(issue);

installZodFa();
