import { cn } from "cn";

export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "کم",
  normal: "عادی",
  high: "بالا",
  urgent: "فوری",
};

const STRIPE: Record<Priority, string> = {
  low: "bg-priority-low",
  normal: "bg-priority-normal",
  high: "bg-priority-high",
  urgent: "bg-priority-urgent",
};

/** The start-edge colour bar of an inbox row. Parent must be `relative`. */
export function PriorityStripe({ priority, className }: { priority: Priority; className?: string }) {
  return <span aria-hidden className={cn("absolute inset-y-2 start-0 w-1 rounded-e-full", STRIPE[priority], className)} />;
}

export function priorityTone(priority: Priority): "neutral" | "primary" | "warning" | "danger" {
  return priority === "low" ? "neutral" : priority === "normal" ? "primary" : priority === "high" ? "warning" : "danger";
}
