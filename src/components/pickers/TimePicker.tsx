"use client";

import { ChevronDown, Clock } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "cn";
import { useIsDesktop } from "@/components/admin/ResponsiveModal";
import { WheelColumn } from "@/components/pickers/WheelColumn";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MINUTE_STEP, defaultTimeMinutes, formatHm, parseHm, snapMinutes } from "@/lib/jalali-grid";
import { toFaDigits } from "@/lib/format";

export interface TimePickerProps {
  /** ASCII `HH:mm` (the DTO shape) or "" = end of the day (۲۳:۵۹). */
  value: string;
  onChange: (value: string) => void;
  /** Submits the ASCII value with the form when the caller posts FormData. */
  name?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const END_OF_DAY = 23 * 60 + 59;
const two = (n: number) => toFaDigits(String(n).padStart(2, "0"));
const hhmm = (minutes: number) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;

/**
 * «ساعت مشخص» — the switch is off by default (the due is the end of the day). Under it, a read-only field in the
 * `Input` material, exactly like the date one: a clock glyph and «ساعت ۲۳:۵۹» (the end of the day, muted) or the
 * chosen «ساعت ۱۳:۵۰». Opening it — from the switch or from the field — puts the two drums (ساعت + دقیقه, like a
 * phone alarm) in a popover from `md` and a bottom sheet on phones, over a footer with **«تأیید»** and
 * **«انصراف»**. The drums drive a DRAFT: nothing reaches `value` (and nothing reaches the hidden input the form
 * posts) until «تأیید». «انصراف» — and Esc — restore what was there before the picker opened, so a switch turned
 * on by mistake goes back off. Enter on a drum confirms. A click outside CONFIRMS what is on screen: the value is
 * settled and visible in the field, and Esc is the undo right next to it (the same forgiving rule as the
 * calendar, where a tapped day commits and closes).
 *
 * The value itself still only ever comes from a SETTLED scroll position — `WheelColumn` commits on `scrollend` /
 * its debounce, never mid-flight — so «تأیید» commits a value the user can read, never a drum in motion.
 */
export function TimePicker({ value, onChange, name, disabled, ...aria }: TimePickerProps) {
  const ids = useId();
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  /** The drums' value while the picker is open; `value` only learns about it on «تأیید». */
  const [draft, setDraft] = useState("");
  /** `value` as it was when the picker opened — what «انصراف» and Esc restore. */
  const previous = useRef("");
  /** Set by Esc / «انصراف» so the one close path knows this was not a confirmation. */
  const cancelling = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  /** Open with the hour drum focused, so ↑↓ turn it and Enter accepts without a Tab first. */
  const focusDrum = (e: Event) => {
    e.preventDefault();
    body.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  };

  const on = value !== "";
  // The field previews the drums while they turn; closed, it shows the committed value (or the end of the day).
  const shownMinutes = open ? (parseHm(draft) ?? END_OF_DAY) : on ? (parseHm(value) ?? END_OF_DAY) : END_OF_DAY;
  const drumMinutes = snapMinutes(parseHm(draft) ?? defaultTimeMinutes());
  const hour = Math.floor(drumMinutes / 60);
  const minute = drumMinutes % 60;

  const openPicker = () => {
    previous.current = value;
    cancelling.current = false;
    setDraft(formatHm(snapMinutes(parseHm(value) ?? defaultTimeMinutes())));
    setOpen(true);
  };

  /** The single exit: commit the draft, or put back what was there before. */
  const finish = (commit: boolean) => {
    cancelling.current = false;
    setOpen(false);
    const next = commit ? draft : previous.current;
    if (next !== value) onChange(next);
  };

  const toggle = (next: boolean) => {
    if (next) {
      openPicker();
      return;
    }
    setOpen(false);
    onChange("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Enter on a drum accepts, the way Enter on a day picks in the calendar. (The content is portalled, so this
    // never reaches the surrounding <form>.)
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
  };

  const drums = (
    <div ref={body} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      {/* `dir="ltr"`: a clock face is LTR in Persian too — the pair reads ساعت then دقیقه, exactly like «۱۳:۵۰». */}
      <div dir="ltr" className="mx-auto grid w-full max-w-[17rem] grid-cols-[1fr_auto_1fr] items-center gap-x-1">
        <span className="text-center text-meta font-medium text-text-muted">ساعت</span>
        <span aria-hidden />
        <span className="text-center text-meta font-medium text-text-muted">دقیقه</span>
        <WheelColumn
          options={HOURS}
          value={hour}
          onChange={(h) => setDraft(formatHm(h * 60 + minute))}
          format={two}
          label="ساعت"
          optionLabel={(h) => `ساعت ${two(h)}`}
        />
        <span aria-hidden className="px-1 text-section font-semibold text-text-muted">
          :
        </span>
        <WheelColumn
          options={MINUTES}
          value={minute}
          onChange={(m) => setDraft(formatHm(hour * 60 + m))}
          format={two}
          label="دقیقه"
          optionLabel={(m) => `${two(m)} دقیقه`}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <Button type="button" variant="ghost" onClick={() => finish(false)}>
          انصراف
        </Button>
        <Button type="button" className="min-w-24" onClick={() => finish(true)}>
          تأیید
        </Button>
      </div>
    </div>
  );

  const fieldLabel = (
    <>
      ساعت{" "}
      <bdi dir="ltr" className="tabular">
        {hhmm(shownMinutes)}
      </bdi>
    </>
  );
  const field = (
    <button
      type="button"
      id={`${ids}-field`}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`ساعت مهلت: ${hhmm(shownMinutes)}`}
      aria-describedby={aria["aria-describedby"]}
      onClick={desktop ? undefined : openPicker}
      className={cn(controlClass, "flex items-center gap-2.5 text-start", !on && !open && "text-text-muted")}
    >
      <Clock className="size-5 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{fieldLabel}</span>
      {!on && !open ? <span className="text-meta text-text-faint">پایان روز</span> : null}
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-3", disabled && "opacity-50")}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <label htmlFor={`${ids}-toggle`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text">ساعت مشخص</span>
          <span className="text-meta text-text-muted">{on ? "مهلت در ساعتِ انتخاب‌شده" : "خاموش: تا پایان روز (۲۳:۵۹)"}</span>
        </span>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            id={`${ids}-toggle`}
            type="checkbox"
            role="switch"
            className="peer sr-only"
            // While the picker is open the switch already reads «on»; «انصراف» puts it back.
            checked={on || open}
            disabled={disabled}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span
            aria-hidden
            className="block h-7 w-12 rounded-full bg-neutral-300 transition-base peer-checked:bg-primary-600 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 after:absolute after:top-0.5 after:start-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-sm after:transition-base peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5"
          />
        </span>
      </label>

      {desktop ? (
        // `modal`: inside the «تمدید» dialog a non-modal popover cannot hold focus — the dialog's focus trap pulls
        // it straight back and the drums never see an arrow key. A trapped layer of its own wins that stack.
        <Popover modal open={open} onOpenChange={(o) => (o ? openPicker() : finish(!cancelling.current))}>
          <PopoverTrigger asChild>{field}</PopoverTrigger>
          <PopoverContent className="w-auto" onOpenAutoFocus={focusDrum} onEscapeKeyDown={() => (cancelling.current = true)}>
            {drums}
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {field}
          <Sheet open={open} onOpenChange={(o) => (o ? openPicker() : finish(!cancelling.current))}>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              className="rounded-t-card pb-[max(env(safe-area-inset-bottom),1rem)]"
              onOpenAutoFocus={focusDrum}
              onEscapeKeyDown={() => (cancelling.current = true)}
            >
              <SheetHeader className="pb-0">
                <SheetTitle className="text-lg">ساعت مهلت</SheetTitle>
                <SheetDescription className="sr-only">ساعت و دقیقه را بچرخانید و «تأیید» را بزنید.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-2">{drums}</div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

/** «۱۸:۳۰» or «۲۳:۵۹» for a summary line. */
export function formatTimeFa(value: string): string {
  const m = value ? parseHm(value) : null;
  return hhmm(m === null ? END_OF_DAY : m);
}
