// The rows of a file list — «فایل‌های تکلیف», a پاسخ's files. No hooks: rendered on the server (the item page) and inside
// the client forms alike. Each row is the download link itself (`/files/<id>`, re-authorized on every request): the
// kind's glyph in a `RowMark`, the name, «<kind> · <size>», and a download glyph at the end. An image opens in a new
// tab (`inline` — an installed app has no back button); everything else downloads in place (`attachment`).
import { Download, FileAudio, FileImage, FileSpreadsheet, FileText, Presentation, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { RowMark } from "@/components/RowMark";
import { cn } from "@/lib/cn";
import { KIND_INFO, type FileFamily, type FileKind } from "../kinds";
import { formatBytesFa } from "../limits";

const FAMILY_ICON: Record<FileFamily, LucideIcon> = {
  pdf: FileText,
  image: FileImage,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  text: FileText,
  audio: FileAudio,
};

export interface FileRowData {
  id: string;
  name: string;
  sizeBytes: number;
  kind: FileKind;
}

export function fileIcon(kind: FileKind): LucideIcon {
  return FAMILY_ICON[KIND_INFO[kind].family];
}

export function fileHref(id: string): string {
  return `/files/${id}`;
}

/** «پی‌دی‌اف · ۲٫۴ مگابایت» */
export function fileMeta(f: Pick<FileRowData, "kind" | "sizeBytes">): string {
  return `${KIND_INFO[f.kind].labelFa} · ${formatBytesFa(f.sizeBytes)}`;
}

export function FileRows({ files, className, label }: { files: readonly FileRowData[]; className?: string; label?: string }): ReactNode {
  if (files.length === 0) return null;
  return (
    <ul className={cn("divide-y divide-line", className)} aria-label={label}>
      {files.map((f) => {
        const inline = KIND_INFO[f.kind].inline;
        return (
          <li key={f.id}>
            <a
              href={fileHref(f.id)}
              {...(inline ? { target: "_blank", rel: "noopener noreferrer" } : { download: "" })}
              className="pressable flex min-h-12 items-center gap-3 px-4 py-2 text-sm hover:bg-surface-sunken"
            >
              <RowMark icon={fileIcon(f.kind)} />
              <span className="flex min-w-0 flex-1 flex-col">
                <bdi className="truncate text-row text-text">{f.name}</bdi>
                <span className="text-meta text-text-muted">{fileMeta(f)}</span>
              </span>
              <Download className="size-4 shrink-0 text-text-faint" aria-hidden />
              <span className="sr-only">{inline ? "باز کردن" : "دریافت"}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
