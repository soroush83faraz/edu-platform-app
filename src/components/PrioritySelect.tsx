"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "cn";
import { PRIORITY_LABELS, type Priority } from "@/components/priority";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { controlClass } from "@/components/ui/input";

export const PRIORITY_ORDER: readonly Priority[] = ["low", "normal", "high", "urgent"];

/** The four priority tokens (`--color-priority-*`): quiet neutral, the sky accent, the one yellow, danger. */
const DOT: Record<Priority, string> = {
  low: "bg-priority-low",
  normal: "bg-priority-normal",
  high: "bg-priority-high",
  urgent: "bg-priority-urgent",
};

export interface PrioritySelectProps {
  value: Priority;
  onChange: (value: Priority) => void;
  /** The visible label that names this control. */
  "aria-labelledby"?: string;
  "aria-label"?: string;
  /** Submits the value with the form when the caller posts FormData. */
  name?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The one priority control: a dropdown in the `Input` material that shows the level it holds — its colour dot plus
 * the word — and opens a four-row list under itself. Open is a 170 ms fade + 4 px rise from 98 %, close the same in
 * reverse at 120 ms, and the chevron turns with it; reduced motion drops all of it (the global clamp). A real
 * `listbox`: Space/Enter/↓ opens, ↑↓ walk the rows, Home/End jump, a Persian letter jumps to that level, Enter
 * picks, Esc closes and hands focus back to the trigger.
 */
export function PrioritySelect({ value, onChange, name, id, disabled, className, ...aria }: PrioritySelectProps) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  // What the arrow keys are pointing at while the list is open — committed on Enter or a click.
  const [active, setActive] = useState<Priority>(value);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  // Opening always starts from the value that is held, never from where the arrows were left last time.
  const setOpenFrom = (next: boolean) => {
    if (next) setActive(value);
    setOpen(next);
  };

  const optionId = (p: Priority) => `${ids}-${p}`;
  const pick = (p: Priority) => {
    onChange(p);
    setOpen(false);
  };

  const moveTo = (i: number) => {
    const next = PRIORITY_ORDER[Math.min(PRIORITY_ORDER.length - 1, Math.max(0, i))];
    setActive(next);
    list.current?.querySelector(`#${CSS.escape(optionId(next))}`)?.scrollIntoView({ block: "nearest" });
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpenFrom(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = PRIORITY_ORDER.indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveTo(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(PRIORITY_ORDER.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key.length === 1) {
      // Typeahead: «ف» goes to فوری, «ب» to بالا — the way a native select behaves.
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key, at: now };
      const hit = PRIORITY_ORDER.find((p) => PRIORITY_LABELS[p].startsWith(typed.current.text));
      if (hit) {
        e.preventDefault();
        setActive(hit);
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpenFrom}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={aria["aria-labelledby"] ? `${aria["aria-labelledby"]} ${ids}-value` : undefined}
          aria-label={aria["aria-label"]}
          onKeyDown={onTriggerKeyDown}
          className={cn(controlClass, "relative flex items-center gap-2.5 pe-10 text-start", className)}
        >
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[value])} />
          <span id={`${ids}-value`} className="flex-1">
            {PRIORITY_LABELS[value]}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("pointer-events-none absolute end-3.5 size-4 text-muted-foreground transition-base", open && "rotate-180")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) p-1 data-open:duration-[170ms] data-closed:duration-[120ms]"
        // The panel rises 4 px from 98 % as it fades in, and sinks back the same way — set here rather than with
        // `zoom-in-*` / `slide-in-*` classes so it beats the shared PopoverContent's own enter/exit values.
        style={
          {
            "--tw-enter-scale": "0.98",
            "--tw-enter-translate-y": "4px",
            "--tw-exit-scale": "0.98",
            "--tw-exit-translate-y": "4px",
          } as React.CSSProperties
        }
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          list.current?.focus();
        }}
      >
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={aria["aria-labelledby"]}
          aria-label={aria["aria-label"]}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKeyDown}
          className="flex flex-col outline-none"
        >
          {PRIORITY_ORDER.map((p) => {
            const selected = p === value;
            return (
              <div
                key={p}
                id={optionId(p)}
                role="option"
                aria-selected={selected}
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(p)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm text-text transition-base",
                  p === active && "bg-surface-sunken",
                  selected && "font-semibold text-primary-700",
                )}
              >
                <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[p])} />
                <span className="flex-1">{PRIORITY_LABELS[p]}</span>
                {selected ? <Check className="size-4 shrink-0 text-primary-600" aria-hidden /> : null}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
