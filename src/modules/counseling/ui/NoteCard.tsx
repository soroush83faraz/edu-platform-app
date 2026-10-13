"use client";

import { Archive, Check, Lock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { Chip } from "@/components/Chip";
import { RelativeTime } from "@/components/RelativeTime";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { archiveCounselorNoteAction, updateCounselorNoteAction } from "../actions";
import { NOTE_KIND_LABELS, NOTE_KINDS, NOTE_MAX, NOTE_VISIBILITIES, NOTE_VISIBILITY_LABELS, type NoteKind, type NoteVisibility } from "../policy";

export interface NoteCardData {
  id: string;
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
  authorName: string;
  /** ISO instants (serialisable across the server/client boundary). */
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  editable: boolean;
}

/**
 * One note of the file: موضوع, «فقط مشاوران» when management cannot read it, the author and when, the text. Its
 * author (still a counselor of the school) gets «ویرایش» and «بایگانی» — the service and the database allow nobody else.
 */
export function NoteCard({ note }: { note: NoteCardData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"edit" | "archive" | null>(null);
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000;

  const archive = () =>
    start(async () => {
      const r = await archiveCounselorNoteAction({ noteId: note.id });
      if (r.ok) {
        toast.success("یادداشت بایگانی شد");
        setMode(null);
        router.refresh();
      } else toast.error(r.message);
    });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone="primary">{NOTE_KIND_LABELS[note.kind]}</Chip>
        {note.visibility === "counselors" ? (
          <Chip>
            <Lock className="size-3" aria-hidden />
            {NOTE_VISIBILITY_LABELS.counselors}
          </Chip>
        ) : null}
        <span className="text-meta text-text-muted">
          <bdi>{note.authorName}</bdi>
          {" · "}
          <RelativeTime at={note.createdAt} mode="time" />
          {edited ? " · ویرایش‌شده" : null}
        </span>
      </div>
      <p className="text-sm leading-7 whitespace-pre-wrap text-text">
        <bdi>{note.body}</bdi>
      </p>
      {note.editable ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={pending} onClick={() => setMode("edit")}>
            <Pencil aria-hidden />
            ویرایش
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-text-muted" disabled={pending} onClick={() => setMode("archive")}>
            <Archive aria-hidden />
            بایگانی
          </Button>
        </div>
      ) : null}

      <ResponsiveModal open={mode === "edit"} onOpenChange={(o) => setMode(o ? "edit" : null)} title="ویرایش یادداشت">
        {mode === "edit" ? <EditNote note={note} onClose={() => setMode(null)} onDone={() => router.refresh()} /> : null}
      </ResponsiveModal>
      <ResponsiveModal open={mode === "archive"} onOpenChange={(o) => setMode(o ? "archive" : null)} title="بایگانی یادداشت" description="یادداشت از پرونده برداشته می‌شود؛ تاریخچهٴ آن در سامانه می‌ماند.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setMode(null)} disabled={pending}>
            انصراف
          </Button>
          <Button type="button" variant="destructive" className="min-w-28" onClick={archive} disabled={pending}>
            <Archive aria-hidden />
            بایگانی
          </Button>
        </div>
      </ResponsiveModal>
    </li>
  );
}

const FIELDS = ["body", "kind", "visibility"];

function EditNote({ note, onClose, onDone }: { note: NoteCardData; onClose: () => void; onDone: () => void }) {
  const ids = useId();
  const [pending, start] = useTransition();
  const [body, setBody] = useState(note.body);
  const [kind, setKind] = useState<NoteKind>(note.kind);
  const [visibility, setVisibility] = useState<NoteVisibility>(note.visibility);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = body.trim() !== note.body || kind !== note.kind || visibility !== note.visibility;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || !dirty || body.trim() === "") return;
    start(async () => {
      const r = await updateCounselorNoteAction({ noteId: note.id, kind, visibility, body: body.trim() });
      if (r.ok) {
        toast.success("تغییرات یادداشت ذخیره شد");
        onClose();
        onDone();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, FIELDS));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-body`}>متن</Label>
        <Textarea id={`${ids}-body`} dir="auto" rows={6} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={errors.body ? true : undefined} />
        <p role="alert" className={cn("text-sm text-danger", !errors.body && "hidden")}>
          {errors.body}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-kind`}>موضوع</Label>
          <SelectNative id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {NOTE_KIND_LABELS[k]}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-visibility`}>چه کسانی ببینند</Label>
          <SelectNative id={`${ids}-visibility`} value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
            {NOTE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {NOTE_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>
      <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
        {errors.form}
      </p>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          انصراف
        </Button>
        <Button type="submit" className="min-w-32" disabled={pending || !dirty || body.trim() === ""}>
          <Check aria-hidden />
          {pending ? "در حال ذخیره…" : "ذخیرهٴ تغییرات"}
        </Button>
      </div>
    </form>
  );
}
