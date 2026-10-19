// files/sniff — a stored upload's kind from its BYTES (magic numbers), never from the client's name or Content-Type.
// Default deny: whatever is not positively one of `KIND_INFO`'s kinds is refused. Server-only (node:zlib).
//
//   • binary formats by signature: PDF, PNG (+ IHDR), JPEG, WebP (RIFF/WEBP + a VP8 chunk), WAV (RIFF/WAVE), OGG,
//     M4A (ISO-BMFF `ftyp` with an audio/MP4 brand), MP3 (an ID3 tag or an MPEG layer-III frame header);
//   • DOCX / XLSX / PPTX: a ZIP read through its CENTRAL DIRECTORY only — nothing is unpacked (no zip bomb can
//     expand): `[Content_Types].xml` and exactly one main part (`word/document.xml` / `xl/workbook.xml` /
//     `ppt/presentation.xml`) must be listed, no `vbaProject.bin`, no encrypted entry, no ZIP64 / multi-disk, and
//     `[Content_Types].xml` itself — inflated with a hard 1 MiB output cap — must declare that main part's OOXML type
//     and nothing `macroEnabled`. Any other ZIP is refused (a ZIP's insides cannot be vouched for without unpacking);
//   • plain text: UTF-8 (fatal decoder over the WHOLE file), no NUL / other C0 control but TAB, LF, FF, CR, and it may
//     not START (after a BOM and white space) with `<` (HTML / SVG / XML) or `#!` (a script).
//
// Tested in tests/unit/files-sniff.test.ts (spoofed extensions, HTML-as-PNG, a ZIP renamed .docx, macro documents,
// empty files, truncated archives).
import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { FileKind } from "./kinds";

/** Random access to the stored bytes (a file handle in production, a buffer in the tests). */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type RejectReason = "empty" | "unknown" | "markup" | "script" | "control" | "encoding" | "zip" | "macro";
export type SniffResult = { ok: true; kind: FileKind } | { ok: false; reason: RejectReason };

const HEAD_BYTES = 4096;
const TEXT_CHUNK = 64 * 1024;
const ZIP_MAX_ENTRIES = 10_000;
const ZIP_MAX_CENTRAL_DIRECTORY = 4 * 1024 * 1024;
const CONTENT_TYPES_MAX_COMPRESSED = 256 * 1024;
const CONTENT_TYPES_MAX_INFLATED = 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** The OOXML main part of each kind and the content type `[Content_Types].xml` must give it. */
const OOXML_MAIN: ReadonlyArray<{ kind: Extract<FileKind, "docx" | "xlsx" | "pptx">; part: string; type: string }> = [
  { kind: "docx", part: "word/document.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" },
  { kind: "xlsx", part: "xl/workbook.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" },
  { kind: "pptx", part: "ppt/presentation.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" },
];

/** ISO-BMFF major brands of an audio-only MP4 («.m4a») as phones and recorders write it. */
const M4A_BRANDS = new Set(["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2"]);

function ascii(b: Uint8Array, at: number, len: number): string {
  if (at + len > b.length) return "";
  let s = "";
  for (let i = at; i < at + len; i++) s += String.fromCharCode(b[i]);
  return s;
}

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (at + sig.length > b.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** An MPEG audio layer III frame header (sync 11 bits, a defined version, layer bits 01, a usable bitrate). */
function isMp3Frame(b: Uint8Array): boolean {
  if (b.length < 3 || b[0] !== 0xff || (b[1] & 0xe6) !== 0xe2) return false;
  const version = (b[1] >> 3) & 0x03;
  const bitrate = (b[2] >> 4) & 0x0f;
  const sampleRate = (b[2] >> 2) & 0x03;
  return version !== 0x01 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03;
}

/** The kind a signature proves, `zip` for a ZIP local header (decided by `ooxmlKind`), or null (maybe text). */
export function signatureKind(head: Uint8Array): FileKind | "zip" | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && ascii(head, 12, 4) === "IHDR") return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, 0, 4) === "RIFF") {
    const form = ascii(head, 8, 4);
    if (form === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(head, 12, 4))) return "webp";
    if (form === "WAVE") return "wav";
    return null;
  }
  if (ascii(head, 0, 4) === "OggS") return "ogg";
  if (ascii(head, 4, 4) === "ftyp" && M4A_BRANDS.has(ascii(head, 8, 4))) return "m4a";
  if (ascii(head, 0, 3) === "ID3" || isMp3Frame(head)) return "mp3";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

/** The kind of a stored file, or why it is refused. Reads the head, the ZIP directory or the whole text — never more than the file. */
export async function sniffKind(src: ByteSource): Promise<SniffResult> {
  if (src.size <= 0) return { ok: false, reason: "empty" };
  const head = await src.read(0, Math.min(HEAD_BYTES, src.size));
  const sig = signatureKind(head);
  if (sig === "zip") return ooxmlKind(src);
  if (sig) return { ok: true, kind: sig };
  return textKind(src, head);
}

// ---------------------------------------------------------------------------------------------------------------
// plain text
// ---------------------------------------------------------------------------------------------------------------

function isAllowedControl(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d;
}

async function textKind(src: ByteSource, head: Uint8Array): Promise<SniffResult> {
  let i = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < head.length && (head[i] === 0x20 || isAllowedControl(head[i]))) i++;
  if (i >= head.length && head.length === src.size) return { ok: false, reason: "empty" }; // white space only
  if (head[i] === 0x3c) return { ok: false, reason: "markup" }; // `<` — HTML, SVG, XML
  if (head[i] === 0x23 && head[i + 1] === 0x21) return { ok: false, reason: "script" }; // `#!`
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let offset = 0; offset < src.size; offset += TEXT_CHUNK) {
    const chunk = await src.read(offset, Math.min(TEXT_CHUNK, src.size - offset));
    for (const b of chunk) {
      if (b === 0x7f || (b < 0x20 && !isAllowedControl(b))) return { ok: false, reason: b === 0 ? "unknown" : "control" };
    }
    try {
      decoder.decode(chunk, { stream: true });
    } catch {
      return { ok: false, reason: "encoding" };
    }
  }
  try {
    decoder.decode();
  } catch {
    return { ok: false, reason: "encoding" }; // a sequence cut off at the end
  }
  return { ok: true, kind: "txt" };
}

// ---------------------------------------------------------------------------------------------------------------
// OOXML (ZIP central directory, nothing unpacked but one capped [Content_Types].xml)
// ---------------------------------------------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const ZIP_REFUSED: SniffResult = { ok: false, reason: "zip" };

/** The central directory's entries, or null when the archive is anything but a plain, single-disk, non-ZIP64 ZIP. */
export async function readZipDirectory(src: ByteSource): Promise<ZipEntry[] | null> {
  if (src.size < 22) return null;
  const tailLength = Math.min(src.size, 22 + 0xffff);
  const tailStart = src.size - tailLength;
  const tail = await src.read(tailStart, tailLength);
  // The end-of-central-directory record: its comment must end exactly at the end of the file.
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === SIG_EOCD && i + 22 + u16(tail, i + 20) === tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const thisDisk = u16(tail, eocd + 4);
  const directoryDisk = u16(tail, eocd + 6);
  const entriesHere = u16(tail, eocd + 8);
  const entries = u16(tail, eocd + 10);
  const directorySize = u32(tail, eocd + 12);
  const directoryOffset = u32(tail, eocd + 16);
  if (thisDisk !== 0 || directoryDisk !== 0 || entriesHere !== entries) return null;
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null; // ZIP64
  if (entries === 0 || entries > ZIP_MAX_ENTRIES || directorySize > ZIP_MAX_CENTRAL_DIRECTORY) return null;
  if (directoryOffset + directorySize > tailStart + eocd) return null;
  const dir = await src.read(directoryOffset, directorySize);
  const out: ZipEntry[] = [];
  const utf8 = new TextDecoder("utf-8", { fatal: false });
  let p = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > dir.length || u32(dir, p) !== SIG_CENTRAL) return null;
    const nameLength = u16(dir, p + 28);
    const extraLength = u16(dir, p + 30);
    const commentLength = u16(dir, p + 32);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > dir.length) return null;
    out.push({
      name: utf8.decode(dir.subarray(p + 46, p + 46 + nameLength)),
      flags: u16(dir, p + 8),
      method: u16(dir, p + 10),
      compressedSize: u32(dir, p + 20),
      uncompressedSize: u32(dir, p + 24),
      localOffset: u32(dir, p + 42),
    });
    p = end;
  }
  return out;
}

/** One small entry's text — stored or deflated, with hard caps on both sides; null when it cannot be read safely. */
async function readSmallEntry(src: ByteSource, e: ZipEntry): Promise<string | null> {
  if (e.compressedSize > CONTENT_TYPES_MAX_COMPRESSED || e.uncompressedSize > CONTENT_TYPES_MAX_INFLATED) return null;
  if (e.localOffset + 30 > src.size) return null;
  const local = await src.read(e.localOffset, 30);
  if (u32(local, 0) !== SIG_LOCAL) return null;
  const dataStart = e.localOffset + 30 + u16(local, 26) + u16(local, 28);
  if (dataStart + e.compressedSize > src.size) return null;
  const data = await src.read(dataStart, e.compressedSize);
  let bytes: Uint8Array;
  if (e.method === 0) bytes = data;
  else if (e.method === 8) {
    try {
      bytes = inflateRawSync(data, { maxOutputLength: CONTENT_TYPES_MAX_INFLATED });
    } catch {
      return null; // corrupt, or it would inflate past the cap
    }
  } else return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function ooxmlKind(src: ByteSource): Promise<SniffResult> {
  const entries = await readZipDirectory(src);
  if (!entries) return ZIP_REFUSED;
  if (entries.some((e) => (e.flags & 0x0001) !== 0)) return ZIP_REFUSED; // encrypted entry
  const lower = new Set(entries.map((e) => e.name.toLowerCase()));
  if ([...lower].some((n) => n.endsWith("vbaproject.bin"))) return { ok: false, reason: "macro" };
  // OPC part names compare case-insensitively; every producer writes this exact one.
  const contentTypes = entries.find((e) => e.name.toLowerCase() === "[content_types].xml");
  if (!contentTypes) return ZIP_REFUSED;
  const mains = OOXML_MAIN.filter((m) => lower.has(m.part));
  if (mains.length !== 1) return ZIP_REFUSED;
  const xml = await readSmallEntry(src, contentTypes);
  if (xml === null) return ZIP_REFUSED;
  if (/macroenabled/i.test(xml)) return { ok: false, reason: "macro" };
  if (!xml.includes(mains[0].type)) return ZIP_REFUSED;
  return { ok: true, kind: mains[0].kind };
}

/** A `ByteSource` over a buffer (tests; small in-memory checks). */
export function bufferSource(buf: Uint8Array): ByteSource {
  return {
    size: buf.length,
    read: async (offset, length) => buf.subarray(Math.max(0, offset), Math.min(buf.length, offset + length)),
  };
}

/** Sniffs a file on disk (the received temp file) through a read-only handle, closed afterwards. */
export async function sniffFile(filePath: string): Promise<SniffResult> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    return await sniffKind({
      size,
      async read(offset, length) {
        const len = Math.max(0, Math.min(length, size - offset));
        const buf = Buffer.alloc(len);
        let got = 0;
        while (got < len) {
          const { bytesRead } = await handle.read(buf, got, len - got, offset + got);
          if (bytesRead === 0) break;
          got += bytesRead;
        }
        return buf.subarray(0, got);
      },
    });
  } finally {
    await handle.close();
  }
}
