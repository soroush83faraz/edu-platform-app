// Presentation helpers: Persian digits and Tehran-local dates. Storage stays UTC; only rendering is localized.
import { format } from "date-fns-jalali";
import { faIR } from "date-fns-jalali/locale";

const faNumber = new Intl.NumberFormat("fa-IR", { useGrouping: true });

export function formatNumberFa(n: number): string {
  return faNumber.format(n);
}

/** ASCII digits → Persian digits inside any string (e.g. a formatted date). */
export function toFaDigits(s: string): string {
  return s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** A Date whose LOCAL fields equal the current wall-clock time in Asia/Tehran (the server runs in UTC). */
export function tehranNow(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** e.g. «یکشنبه ۲۹ شهریور ۱۴۰۵». */
export function formatJalaliLong(date = tehranNow()): string {
  return toFaDigits(format(date, "EEEE d MMMM yyyy", { locale: faIR }));
}
