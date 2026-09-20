"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { PRIORITY_LABELS, type Priority } from "@/components/PriorityStripe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJalaliNumeric, formatNumberFa } from "@/lib/format";
import { createWorkItemAction, offeringRosterQuery, searchPersonsQuery } from "../actions";
import type { OfferingRow, PersonHit, RosterRow } from "../repo";

export interface NewWorkItemFormProps {
  offerings: OfferingRow[];
  canPickPersons: boolean;
}

type Mode = "class" | "persons" | "self";
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const DAY = 86_400_000;

export function NewWorkItemForm({ offerings, canPickPersons }: NewWorkItemFormProps) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const canClass = offerings.length > 0;
  const [mode, setMode] = useState<Mode>(canClass ? "class" : canPickPersons ? "persons" : "self");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");

  // ---- class recipients
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [rosterFilter, setRosterFilter] = useState("");
  const selectOffering = (id: string) => {
    setOfferingId(id);
    setRoster(null);
    setExcluded(new Set());
  };
  useEffect(() => {
    if (mode !== "class" || !offeringId || roster !== null) return;
    let alive = true;
    void offeringRosterQuery({ classOfferingId: offeringId }).then((r) => {
      if (!alive) return;
      if (r.ok) setRoster(r.data);
      else toast.error(r.message);
    });
    return () => {
      alive = false;
    };
  }, [mode, offeringId, roster]);
  const visibleRoster = useMemo(() => {
    const q = rosterFilter.trim();
    if (!roster) return [];
    return q ? roster.filter((s) => `${s.firstName} ${s.lastName}`.includes(q)) : roster;
  }, [roster, rosterFilter]);
  const selectedCount = roster ? roster.length - excluded.size : 0;

  // ---- person recipients
  const [personQuery, setPersonQuery] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [chosen, setChosen] = useState<PersonHit[]>([]);
  useEffect(() => {
    if (mode !== "persons") return;
    const q = personQuery.trim();
    const t = window.setTimeout(() => {
      if (q.length < 2) {
        setHits([]);
        return;
      }
      void searchPersonsQuery({ q }).then((r) => {
        if (r.ok) setHits(r.data.filter((h) => !chosen.some((c) => c.id === h.id)));
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [mode, personQuery, chosen]);

  const today = new Date();
  const dueChips: [string, string][] = [
    ["امروز", formatJalaliNumeric(today)],
    ["فردا", formatJalaliNumeric(new Date(today.getTime() + DAY))],
    ["هفتهٴ بعد", formatJalaliNumeric(new Date(today.getTime() + 7 * DAY))],
  ];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    const description = String(fd.get("description") ?? "").trim();
    const next: Record<string, string> = {};
    if (!title) next.title = "عنوان را وارد کنید.";
    if (mode === "class" && (!offeringId || selectedCount === 0)) next.recipients = "دست‌کم یک دانش‌آموز را انتخاب کنید.";
    if (mode === "persons" && chosen.length === 0) next.recipients = "دست‌کم یک گیرنده انتخاب کنید.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const recipients =
      mode === "class"
        ? ({ kind: "class_offering", id: offeringId, excludePersonIds: [...excluded] } as const)
        : mode === "persons"
          ? ({ kind: "persons", ids: chosen.map((c) => c.id) } as const)
          : ({ kind: "self" } as const);

    start(async () => {
      const r = await createWorkItemAction({
        typeCode: mode === "self" ? "todo" : "task",
        title,
        description: description || undefined,
        priority,
        dueDate: dueDate || undefined,
        dueTime: dueTime || undefined,
        recipients,
      });
      if (r.ok) {
        toast.success("کار ایجاد شد");
        router.push(`/inbox/${r.data.id}`);
        return;
      }
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.fieldErrors ?? {})) fe[k.split(".")[0]] = v[0];
      if (Object.keys(fe).length === 0) fe.form = r.message;
      setErrors(fe);
    });
  };

  const field = (name: string) => ({ id: `${ids}-${name}`, error: errors[name], describedBy: errors[name] ? `${ids}-${name}-err` : undefined });
  const titleF = field("title");
  const dueF = field("dueDate");

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={titleF.id} className="text-sm font-medium text-text">
          عنوان
        </label>
        <Input id={titleF.id} name="title" dir="auto" maxLength={200} required className="h-11 bg-surface" placeholder="مثلاً: تمرین صفحهٴ ۴۲" aria-invalid={titleF.error ? true : undefined} aria-describedby={titleF.describedBy} autoFocus />
        <FieldError id={`${titleF.id}-err`} text={titleF.error} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-desc`} className="text-sm font-medium text-text">
          توضیح <span className="text-text-faint">(اختیاری)</span>
        </label>
        <textarea
          id={`${ids}-desc`}
          name="description"
          dir="auto"
          rows={3}
          maxLength={4000}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base leading-7 outline-none placeholder:text-text-faint focus-visible:border-primary-400 focus-visible:ring-3 focus-visible:ring-primary-400/30"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">اولویت</legend>
        <div className="grid grid-cols-4 gap-2">
          {PRIORITIES.map((p) => (
            <label
              key={p}
              className={cn(
                "flex h-11 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-primary-400",
                priority === p ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted",
              )}
            >
              <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
              {PRIORITY_LABELS[p]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={dueF.id} className="text-sm font-medium text-text">
          مهلت <span className="text-text-faint">(اختیاری)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {dueChips.map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => setDueDate(value)}
              aria-pressed={dueDate === value}
              className={cn(
                "h-9 rounded-full border px-3 text-sm transition-colors",
                dueDate === value ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            id={dueF.id}
            name="dueDate"
            inputMode="numeric"
            placeholder="۱۴۰۵/۰۷/۰۵"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-11 bg-surface tabular"
            aria-invalid={dueF.error ? true : undefined}
            aria-describedby={dueF.describedBy}
          />
          <Input name="dueTime" inputMode="numeric" placeholder="ساعت ۲۳:۵۹" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="h-11 w-28 bg-surface tabular" aria-label="ساعت مهلت" />
        </div>
        <FieldError id={`${dueF.id}-err`} text={dueF.error} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text">گیرندگان</legend>
        <div className="flex flex-wrap gap-2">
          {canClass ? <ModeChip label="کلاس" active={mode === "class"} onClick={() => setMode("class")} /> : null}
          {canPickPersons ? <ModeChip label="اشخاص" active={mode === "persons"} onClick={() => setMode("persons")} /> : null}
          <ModeChip label="خودم" active={mode === "self"} onClick={() => setMode("self")} />
        </div>

        {mode === "class" ? (
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
            <select
              aria-label="درس و کلاس"
              value={offeringId}
              onChange={(e) => selectOffering(e.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-base outline-none focus-visible:border-primary-400 focus-visible:ring-3 focus-visible:ring-primary-400/30"
            >
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.subjectName} {o.classGroupName} ({formatNumberFa(o.studentCount)} دانش‌آموز)
                </option>
              ))}
            </select>
            {roster === null ? (
              <p className="text-sm text-text-muted">در حال بارگذاری فهرست کلاس…</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="tabular text-text">
                    {formatNumberFa(selectedCount)} از {formatNumberFa(roster.length)} نفر انتخاب شده
                  </span>
                  <span className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setExcluded(new Set())}>
                      همه
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setExcluded(new Set(roster.map((s) => s.personId)))}>
                      هیچ‌کدام
                    </Button>
                  </span>
                </div>
                {roster.length > 8 ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
                    <Input value={rosterFilter} onChange={(e) => setRosterFilter(e.target.value)} placeholder="جست‌وجوی نام" aria-label="جست‌وجو در فهرست کلاس" className="h-11 bg-surface ps-9" />
                  </div>
                ) : null}
                <ul className="max-h-72 overflow-y-auto divide-y divide-line rounded-lg border border-line">
                  {visibleRoster.map((s) => {
                    const checked = !excluded.has(s.personId);
                    return (
                      <li key={s.personId}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-surface-sunken">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary-600"
                            checked={checked}
                            onChange={() =>
                              setExcluded((prev) => {
                                const n = new Set(prev);
                                if (n.has(s.personId)) n.delete(s.personId);
                                else n.add(s.personId);
                                return n;
                              })
                            }
                          />
                          <span className={cn("flex-1", !checked && "text-text-faint line-through")}>
                            <bdi>
                              {s.firstName} {s.lastName}
                            </bdi>
                          </span>
                          <bdi dir="ltr" className="tabular text-xs text-text-faint">
                            {s.studentNumber}
                          </bdi>
                        </label>
                      </li>
                    );
                  })}
                  {visibleRoster.length === 0 ? <li className="px-3 py-3 text-sm text-text-muted">{roster.length === 0 ? "این کلاس دانش‌آموز فعالی ندارد." : "نامی با این جست‌وجو پیدا نشد."}</li> : null}
                </ul>
              </>
            )}
          </div>
        ) : null}

        {mode === "persons" ? (
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
            {chosen.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {chosen.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setChosen((prev) => prev.filter((x) => x.id !== c.id))}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-primary-50 ps-3 pe-2 text-sm text-primary-700"
                      aria-label={`حذف ${c.firstName} ${c.lastName}`}
                    >
                      <bdi>
                        {c.firstName} {c.lastName}
                      </bdi>
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
              <Input value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} placeholder="نام شخص (دست‌کم دو حرف)" aria-label="جست‌وجوی اشخاص" className="h-11 bg-surface ps-9" />
            </div>
            {hits.length > 0 ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen((prev) => [...prev, h]);
                        setPersonQuery("");
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-start text-sm hover:bg-surface-sunken"
                    >
                      <bdi>
                        {h.firstName} {h.lastName}
                      </bdi>
                      <span className="text-xs text-text-faint">{h.kind === "student" ? "دانش‌آموز" : h.kind === "staff" ? "کادر" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {mode === "self" ? <p className="text-sm text-text-muted">یک کار شخصی فقط در کارتابل خودتان می‌ماند.</p> : null}
        <FieldError id={`${ids}-recipients-err`} text={errors.recipients} />
      </fieldset>

      <p role="alert" className="min-h-5 text-sm text-danger">
        {errors.form}
      </p>
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending || (mode === "class" && roster === null)}>
        {pending ? "در حال ایجاد…" : mode === "class" && roster ? `ارسال به ${formatNumberFa(selectedCount)} نفر` : "ایجاد کار"}
      </Button>
    </form>
  );
}

function ModeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-10 rounded-full border px-4 text-sm transition-colors",
        active ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong",
      )}
    >
      {label}
    </button>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
