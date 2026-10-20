"use client";

// The two controls of a «تنظیمات» row: a feature switch (روشن / خاموش / پیروی) and a setting (a number with its unit,
// or a daily time range), each with its own «ذخیره». The server decides everything (setFlagAction / setSettingAction);
// after a save the page re-renders with the new effective value and its source.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNative } from "@/components/ui/select-native";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { setFlagAction, setSettingAction } from "../actions";
import type { FlagKey } from "../flags";
import type { SettingKey, TimeRangeValue } from "../settings";

type FlagChoice = "on" | "off" | "inherit";

export function FlagControl({
  flagKey,
  label,
  schoolId,
  own,
  inherited,
  inheritLabel,
}: {
  flagKey: FlagKey;
  label: string;
  schoolId: string | null;
  own: boolean | null;
  inherited: boolean;
  /** «پیش‌فرض» at the organization, «پیروی از سازمان» at a school. */
  inheritLabel: string;
}) {
  const router = useRouter();
  const initial: FlagChoice = own === null ? "inherit" : own ? "on" : "off";
  const [choice, setChoice] = useState<FlagChoice>(initial);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await setFlagAction({ key: flagKey, schoolId, value: choice });
      if (r.ok) {
        toast.success(`«${label}» ذخیره شد.`);
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <div className="flex items-center gap-2">
      <SelectNative value={choice} onChange={(e) => setChoice(e.target.value as FlagChoice)} aria-label={`وضعیت ${label}`} wrapperClassName="w-48" className="h-11">
        <option value="inherit">{`${inheritLabel} (${inherited ? "روشن" : "خاموش"})`}</option>
        <option value="on">روشن</option>
        <option value="off">خاموش</option>
      </SelectNative>
      <Button type="button" variant="outline" className="h-11 min-w-20" disabled={pending || choice === initial} onClick={save}>
        ذخیره
      </Button>
    </div>
  );
}

function rangeText(v: TimeRangeValue): string {
  return `${toFaDigits(v.start)} تا ${toFaDigits(v.end)}`;
}

export function SettingControl({
  settingKey,
  label,
  schoolId,
  kind,
  unitFa,
  min,
  max,
  own,
  inherited,
  inheritLabel,
}: {
  settingKey: SettingKey;
  label: string;
  schoolId: string | null;
  kind: "int" | "time_range";
  unitFa: string | null;
  min: number | null;
  max: number | null;
  own: number | TimeRangeValue | null;
  inherited: number | TimeRangeValue;
  inheritLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ownRange = typeof own === "object" && own !== null ? own : null;
  const inheritedRange = typeof inherited === "object" ? inherited : null;
  const [value, setValue] = useState(typeof own === "number" ? formatNumberFa(own) : "");
  const [startAt, setStartAt] = useState(ownRange?.start ?? inheritedRange?.start ?? "");
  const [endAt, setEndAt] = useState(ownRange?.end ?? inheritedRange?.end ?? "");
  const run = (mode: "set" | "inherit") =>
    start(async () => {
      const r = await setSettingAction({ key: settingKey, schoolId, mode, ...(mode === "set" ? (kind === "int" ? { value } : { start: startAt, end: endAt }) : {}) });
      if (r.ok) {
        toast.success(mode === "set" ? `«${label}» ذخیره شد.` : `«${label}» به ${inheritLabel} برگشت.`);
        if (mode === "inherit") {
          setValue("");
          if (inheritedRange) {
            setStartAt(inheritedRange.start);
            setEndAt(inheritedRange.end);
          }
        }
        router.refresh();
      } else toast.error(r.message);
    });
  const inheritedText = typeof inherited === "number" ? `${formatNumberFa(inherited)} ${unitFa ?? ""}`.trim() : rangeText(inherited);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {kind === "int" ? (
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="numeric"
              placeholder={typeof inherited === "number" ? formatNumberFa(inherited) : ""}
              aria-label={label}
              aria-describedby={`${settingKey}-range`}
              className="h-11 w-24 tabular"
            />
            <span>{unitFa}</span>
          </label>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              از
              <Input type="time" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label={`${label} — آغاز`} className="h-11 w-32 tabular" />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              تا
              <Input type="time" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-label={`${label} — پایان`} className="h-11 w-32 tabular" />
            </label>
          </>
        )}
        <Button type="button" variant="outline" className="h-11 min-w-20" disabled={pending || (kind === "int" && value.trim() === "")} onClick={() => run("set")}>
          ذخیره
        </Button>
        {own !== null ? (
          <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => run("inherit")}>
            {inheritLabel}
          </Button>
        ) : null}
      </div>
      <p id={`${settingKey}-range`} className="text-meta text-text-muted">
        {kind === "int" && min !== null && max !== null ? `از ${formatNumberFa(min)} تا ${formatNumberFa(max)} ${unitFa ?? ""}؛ ` : ""}
        {own === null ? `اکنون ${inheritLabel}: ${inheritedText}` : `بدون این مقدار: ${inheritedText}`}
      </p>
    </div>
  );
}
