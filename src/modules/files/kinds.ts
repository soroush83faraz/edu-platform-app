// files/kinds — the ONE allowlist of file types (owner 2026-10-19, «پیوست تکلیف و تحویل پاسخ»; docs/decisions.md).
// A file's kind is decided by its MAGIC BYTES on the server (./sniff), never by the client's name or Content-Type;
// everything else about serving it follows from the kind: the Content-Type we send, the extension its download name
// must carry, and whether a browser may show it in place (images only — PDFs are downloaded, see the route
// `src/app/files/[id]/route.ts`). Pure: imported by client components too (the picker's `accept`, the row icons).

export const FILE_KINDS = ["pdf", "png", "jpeg", "webp", "docx", "xlsx", "pptx", "txt", "mp3", "m4a", "ogg", "wav"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** What a row draws for a kind (an icon family) — `src/modules/files/ui`. */
export type FileFamily = "pdf" | "image" | "document" | "spreadsheet" | "presentation" | "text" | "audio";

export interface KindInfo {
  /** The Content-Type the download route sends (charset included for text) — the only one we ever send for it. */
  mime: string;
  /** Accepted extensions, lowercase, without the dot; the FIRST is the canonical one a mismatched name is given. */
  extensions: readonly string[];
  /**
   * May a browser render it in place (`Content-Disposition: inline`)? Images only, served under
   * `Content-Security-Policy: sandbox; default-src 'none'` + `nosniff`. A PDF is NOT inline: the browsers' PDF viewers
   * refuse to run under a CSP sandbox, and a PDF outside one can carry script into the viewer.
   */
  inline: boolean;
  family: FileFamily;
  /** The Persian word for the kind (no Latin in the UI). */
  labelFa: string;
}

export const KIND_INFO: Record<FileKind, KindInfo> = {
  pdf: { mime: "application/pdf", extensions: ["pdf"], inline: false, family: "pdf", labelFa: "پی‌دی‌اف" },
  png: { mime: "image/png", extensions: ["png"], inline: true, family: "image", labelFa: "تصویر" },
  jpeg: { mime: "image/jpeg", extensions: ["jpg", "jpeg"], inline: true, family: "image", labelFa: "تصویر" },
  webp: { mime: "image/webp", extensions: ["webp"], inline: true, family: "image", labelFa: "تصویر" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"], inline: false, family: "document", labelFa: "سند ورد" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"], inline: false, family: "spreadsheet", labelFa: "کاربرگ اکسل" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extensions: ["pptx"], inline: false, family: "presentation", labelFa: "ارائهٴ پاورپوینت" },
  txt: { mime: "text/plain; charset=utf-8", extensions: ["txt", "csv", "md"], inline: false, family: "text", labelFa: "متن" },
  mp3: { mime: "audio/mpeg", extensions: ["mp3"], inline: false, family: "audio", labelFa: "صوت" },
  m4a: { mime: "audio/mp4", extensions: ["m4a"], inline: false, family: "audio", labelFa: "صوت" },
  ogg: { mime: "audio/ogg", extensions: ["ogg", "oga", "opus"], inline: false, family: "audio", labelFa: "صوت" },
  wav: { mime: "audio/wav", extensions: ["wav"], inline: false, family: "audio", labelFa: "صوت" },
};

/** The stored `file_object.mime` (always one of KIND_INFO's) → its kind; null for anything else (never served as such). */
export function kindOfMime(mime: string): FileKind | null {
  for (const k of FILE_KINDS) if (KIND_INFO[k].mime === mime) return k;
  return null;
}

/**
 * The file input's `accept` — a convenience for the device picker only (the server decides by content). Extensions
 * AND types, so mobile pickers offer the right apps; HEIC is left out on purpose (iOS hands a JPEG to a picker that
 * does not ask for HEIC).
 */
export const ACCEPT_ATTRIBUTE = [
  ...FILE_KINDS.flatMap((k) => KIND_INFO[k].extensions.map((e) => `.${e}`)),
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  KIND_INFO.docx.mime,
  KIND_INFO.xlsx.mime,
  KIND_INFO.pptx.mime,
  "text/plain",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
].join(",");
