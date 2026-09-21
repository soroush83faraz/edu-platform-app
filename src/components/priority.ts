import type { IconChipTone } from "@/components/IconChip";

export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "کم",
  normal: "عادی",
  high: "بالا",
  urgent: "فوری",
};

/** Chip/Chip-tone for a priority: low = quiet neutral, normal = accent, high = warning, urgent = danger. */
export function priorityTone(priority: Priority): "neutral" | "primary" | "warning" | "danger" {
  return priority === "low" ? "neutral" : priority === "normal" ? "primary" : priority === "high" ? "warning" : "danger";
}

/** The icon-chip tint of an inbox row — the priority now lives in the chip, not in an edge stripe. */
export function priorityChipTone(priority: Priority): IconChipTone {
  return priority === "low" ? "muted" : priority === "normal" ? "primary" : priority === "high" ? "warning" : "danger";
}
