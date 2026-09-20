import { formatNumberFa } from "@/lib/format";

/** A number in Persian digits with tabular figures. */
export function PersianNumber({ value, className }: { value: number; className?: string }) {
  return <span className={className ? `tabular ${className}` : "tabular"}>{formatNumberFa(value)}</span>;
}
