export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "کم",
  normal: "عادی",
  high: "بالا",
  urgent: "فوری",
};

/** Chip tone for a priority (the detail facts): low = quiet neutral, normal = accent, high = warning, urgent = danger. In lists the priority is `PriorityDot` (`RowMark.tsx`). */
export function priorityTone(priority: Priority): "neutral" | "primary" | "warning" | "danger" {
  return priority === "low" ? "neutral" : priority === "normal" ? "primary" : priority === "high" ? "warning" : "danger";
}
