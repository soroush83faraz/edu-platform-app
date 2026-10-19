// files/names — the display name of an upload. The client's file name is DATA, never a path: it is stored in
// `file_object.original_name` (the bytes live under a server-made key with no part of the name in it, ./paths) and
// comes back only as text on a row and in `Content-Disposition`. Pure (unit-tested: tests/unit/files-names.test.ts).
//
//   1. percent-decoded from the `X-File-Name` header (the client encodes it; a raw non-ASCII header is refused);
//   2. NFC; everything up to the last `/` or `\` dropped (a «C:\fakepath\…» or «../../x» is just its last segment);
//   3. control characters (C0, DEL, C1), bidi controls (LRM/RLM/ALM, the embeddings and overrides U+202A–E, the
//      isolates U+2066–9) and invisible formatting (ZWSP, ZWJ, word joiner, BOM …) removed — but NOT the Persian
//      half-space U+200C (ZWNJ); characters a Windows file name may not hold (`<>:"|?*`) become `_`;
//   4. white space collapsed, leading/trailing spaces and dots trimmed, a Windows device name (CON, NUL, COM1 …)
//      prefixed with `_`, the length capped in code points (extension kept);
//   5. the extension must be one the SNIFFED kind accepts (./kinds); otherwise the kind's canonical extension
//      replaces it — so a download can only ever carry the extension of what it really is («x.pdf.exe» holding a
//      PDF is served as «x.pdf»; an executable never gets this far — ./sniff refuses it).
import { FILE_LIMITS } from "./limits";
import { KIND_INFO, type FileKind } from "./kinds";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_AND_INVISIBLE = /[\u00ad\u061c\u180e\u200b\u200d-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;
const WINDOWS_RESERVED_CHARS = /[<>:"|?*]/g;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const EXTENSION = /^[a-z0-9]{1,10}$/;

/** The header value → the name, or null (absent, too long, not percent-encoded UTF-8). */
export function decodeHeaderName(header: string | null | undefined): string | null {
  if (!header || header.length > 2048) return null;
  if (!/^[\x21-\x7e]*$/.test(header)) return null; // the client percent-encodes; anything raw is refused
  try {
    return decodeURIComponent(header);
  } catch {
    return null;
  }
}

export function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: "" };
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION.test(ext) ? { base: name.slice(0, dot), ext } : { base: name, ext: "" };
}

function capCodePoints(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("");
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
}

/** Steps 2–4: a safe display name (extension untouched apart from case), or null when nothing usable is left. */
export function sanitizeFileName(raw: string): string | null {
  let name = raw.normalize("NFC");
  name = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  name = name.replace(CONTROL, "").replace(BIDI_AND_INVISIBLE, "").replace(WINDOWS_RESERVED_CHARS, "_");
  name = tidy(name);
  if (name === "") return null;
  if (WINDOWS_DEVICE.test(name)) name = `_${name}`;
  const { base, ext } = splitExtension(name);
  const room = FILE_LIMITS.maxNameChars - (ext ? ext.length + 1 : 0);
  const cappedBase = tidy(capCodePoints(base, room));
  if (cappedBase === "") return null;
  return ext ? `${cappedBase}.${ext}` : cappedBase;
}

/** Step 5: the name with an extension of `kind` — its own when allowed, the canonical one otherwise. */
export function nameForKind(name: string, kind: FileKind): string {
  const allowed = KIND_INFO[kind].extensions;
  const canonical = allowed[0];
  const { base, ext } = splitExtension(name);
  if (ext && allowed.includes(ext)) return `${base}.${ext}`;
  // «تمرین.pdf.exe» holding a PDF: the base already ends in the right extension.
  const inner = splitExtension(base);
  if (inner.ext && allowed.includes(inner.ext)) return `${inner.base}.${inner.ext}`;
  const room = FILE_LIMITS.maxNameChars - canonical.length - 1;
  return `${tidy(capCodePoints(base, room)) || "فایل"}.${canonical}`;
}

/** RFC 5987 `ext-value` characters: everything encodeURIComponent leaves alone except `'()*`. */
function rfc5987(s: string): string {
  return encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The plain `filename=` for old clients: printable ASCII only, no quote / backslash / percent / semicolon. */
function asciiFallback(name: string): string {
  const { base, ext } = splitExtension(name);
  const asciiBase = tidy(
    base
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\%;]/g, "_"),
  );
  return `${asciiBase || "file"}${ext ? `.${ext}` : ""}`;
}

/** `attachment; filename="…"; filename*=UTF-8''…` — the name is already sanitized; this only encodes it. */
export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  return `${disposition}; filename="${asciiFallback(name)}"; filename*=UTF-8''${rfc5987(name)}`;
}
