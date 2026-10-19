// files/sniff — a stored upload's kind from its BYTES (magic numbers), never from the client's name or Content-Type.
// Default deny: whatever is not positively one of `KIND_INFO`'s kinds is refused. Server-only (node:zlib).
//
//   • binary formats by signature: PDF, PNG (+ IHDR), JPEG, WebP (RIFF/WEBP + a VP8 chunk), WAV (RIFF/WAVE), OGG,
//     M4A (ISO-BMFF `ftyp` with an audio/MP4 brand), MP3 (an ID3 tag or an MPEG layer-III frame header);
//   • DOCX / XLSX / PPTX: a ZIP read through its CENTRAL DIRECTORY — nothing is unpacked but its small XML parts,
//     `[Content_Types].xml` and every relationship part (`*.rels`), each inflated under ONE hard cap for all of them
//     together (1 MiB — no zip bomb can expand). Refused (security review 2026-10-19, D5: what makes Office run code
//     or reach out when the file is opened):
//       – anything but a plain, single-disk, non-ZIP64, unencrypted ZIP whose part names are unique;
//       – macros, by part name (`vbaProject`, `vbaData`) AND by every DECLARED type — each Default and Override of
//         `[Content_Types].xml`, entity-decoded (`macroEnabled`, `vbaProject`, macro sheets, Word customizations) —
//         so `word/m.bin` declared as a VBA project is one;
//       – embedded and active objects: `embeddings/` (OLE packages, the workbook behind a chart), OLE objects,
//         ActiveX, Excel's external links, data connections and query tables — by part name, declared type and
//         relationship type;
//       – every relationship with `TargetMode="External"` but a hyperlink to http(s) / mailto (an attached template,
//         an OLE link, a frame, a linked image or video …), and the relationship types that pull content in
//         (`aFChunk`, `attachedTemplate`, `subDocument`, `package`, `control` …) whatever their target;
//       – a main part (exactly one of `word/document.xml` / `xl/workbook.xml` / `ppt/presentation.xml`) that is not
//         the package's officeDocument relationship, has no matching LOCAL header (the same name, its data where the
//         central directory says), or whose content type is not that part's OOXML type;
//       – XML parts that are not UTF-8 or carry a DTD.
//     Any other ZIP is refused (a ZIP's insides cannot be vouched for without unpacking);
//   • plain text: UTF-8 (fatal decoder over the WHOLE file), no NUL / other C0 control but TAB, LF, FF, CR, and it may
//     not START (after a BOM and white space) with `<` (HTML / SVG / XML) or `#!` (a script). It is always stored and
//     served as `.txt` (./kinds) — never `.csv`, so no spreadsheet opens it and runs a `=cmd|…` cell by itself.
//
// Tested in tests/unit/files-sniff.test.ts (spoofed extensions, HTML-as-PNG, a ZIP renamed .docx, macro documents,
// external relationships, embedded objects, a central-directory-only main part, empty files, truncated archives).
import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { FileKind } from "./kinds";

/** Random access to the stored bytes (a file handle in production, a buffer in the tests). */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type RejectReason = "empty" | "unknown" | "markup" | "script" | "control" | "encoding" | "zip" | "macro" | "active";
export type SniffResult = { ok: true; kind: FileKind } | { ok: false; reason: RejectReason };

const HEAD_BYTES = 4096;
const TEXT_CHUNK = 64 * 1024;
const ZIP_MAX_ENTRIES = 10_000;
const ZIP_MAX_CENTRAL_DIRECTORY = 4 * 1024 * 1024;

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
// OOXML (ZIP central directory; nothing unpacked but the small XML parts, under one capped budget)
// ---------------------------------------------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  /** The name's bytes as the central directory holds them — compared with the local header's. */
  rawName: Uint8Array;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

interface ZipDirectory {
  entries: ZipEntry[];
  /** Where the central directory starts: every entry's local header and data lie before it. */
  directoryOffset: number;
}

const ZIP_REFUSED: SniffResult = { ok: false, reason: "zip" };
const MACRO: SniffResult = { ok: false, reason: "macro" };
const ACTIVE: SniffResult = { ok: false, reason: "active" };

// What makes Office run code or reach out when a document is opened (security review 2026-10-19, D5). Matched
// lower-case, on percent-decoded part names, on every DECLARED content type of [Content_Types].xml (entity-decoded)
// and on every relationship type — never on the part names alone, which a producer chooses freely (`word/m.bin`).
/** Part names: a VBA project or its data. */
const MACRO_PART_MARKS = ["vbaproject", "vbadata"];
/** Part names: embedded objects (an OLE package, a workbook inside a chart), ActiveX, Excel's links to the outside. */
const ACTIVE_PART_MARKS = ["embeddings/", "activex", "oleobject", "externallinks/", "querytables/"];
const ACTIVE_PART_SUFFIXES = ["/connections.xml"];
/** Declared content types: macros, macro sheets, Word's key / toolbar customizations (only macros use them). */
const MACRO_TYPE_MARKS = ["vbaproject", "vbadata", "macroenabled", "macrosheet", "keymapcustomizations", "attachedtoolbars"];
/** Declared content types: ActiveX, OLE objects, Excel's data connections, query tables and external links. */
const ACTIVE_TYPE_MARKS = ["activex", "oleobject", "spreadsheetml.connections", "spreadsheetml.querytable", "spreadsheetml.externallink"];
/** Relationship types refused whatever their target. */
const MACRO_REL_MARKS = ["vbaproject", "vbadata", "keymapcustomizations", "attachedtoolbars"];
const ACTIVE_REL_MARKS = ["oleobject", "activex", "afchunk", "attachedtemplate", "subdocument", "externallink", "connections", "querytable"];
const ACTIVE_REL_SUFFIXES = ["/control", "/package", "/frame"];
/** The one external target a document may keep: a hyperlink (opened only by a click) to the web or a mail address. */
const HYPERLINK_REL_SUFFIX = "/relationships/hyperlink";
const SAFE_HYPERLINK = /^(?:https?:\/\/|mailto:)/i;

/** Inflated bytes ALL small XML parts of one archive may produce together ([Content_Types].xml + every .rels). */
const XML_BUDGET = 1024 * 1024;
const XML_PART_MAX_COMPRESSED = 256 * 1024;

/** The central directory, or null when the archive is anything but a plain, single-disk, non-ZIP64 ZIP. */
async function readZip(src: ByteSource): Promise<ZipDirectory | null> {
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
    const rawName = dir.slice(p + 46, p + 46 + nameLength);
    out.push({
      name: utf8.decode(rawName),
      rawName,
      flags: u16(dir, p + 8),
      method: u16(dir, p + 10),
      compressedSize: u32(dir, p + 20),
      uncompressedSize: u32(dir, p + 24),
      localOffset: u32(dir, p + 42),
    });
    p = end;
  }
  return { entries: out, directoryOffset };
}

/** The central directory's entries (see `readZip`). */
export async function readZipDirectory(src: ByteSource): Promise<ZipEntry[] | null> {
  return (await readZip(src))?.entries ?? null;
}

/**
 * Where an entry's data starts when its LOCAL header is really there and agrees with the central directory — the
 * same name bytes, not encrypted, its data wholly before the central directory; null otherwise (a central-directory-
 * only entry, or one a streaming reader would see under another name).
 */
async function localDataStart(src: ByteSource, e: ZipEntry, directoryOffset: number): Promise<number | null> {
  if (e.localOffset + 30 > directoryOffset) return null;
  const local = await src.read(e.localOffset, 30);
  if (local.length < 30 || u32(local, 0) !== SIG_LOCAL || (u16(local, 6) & 0x0001) !== 0) return null;
  const nameLength = u16(local, 26);
  if (nameLength !== e.rawName.length) return null;
  const name = await src.read(e.localOffset + 30, nameLength);
  for (let i = 0; i < nameLength; i++) if (name[i] !== e.rawName[i]) return null;
  const dataStart = e.localOffset + 30 + nameLength + u16(local, 28);
  return dataStart + e.compressedSize <= directoryOffset ? dataStart : null;
}

/** UTF-8 XML without a DTD, comments removed — or null (UTF-16, another declared encoding, a NUL, a DOCTYPE / ENTITY). */
function xmlText(bytes: Uint8Array): string | null {
  if (bytes.includes(0) || startsWith(bytes, [0xfe, 0xff]) || startsWith(bytes, [0xff, 0xfe])) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const declared = /^﻿?\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i.exec(text);
  if (declared && declared[1].trim().toLowerCase() !== "utf-8") return null;
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null;
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** One small XML part — stored or deflated, its inflated size taken from the archive's budget; null when unsafe. */
async function readXmlPart(src: ByteSource, e: ZipEntry, directoryOffset: number, budget: { left: number }): Promise<string | null> {
  if (e.compressedSize > XML_PART_MAX_COMPRESSED) return null;
  const dataStart = await localDataStart(src, e, directoryOffset);
  if (dataStart === null) return null;
  const data = await src.read(dataStart, e.compressedSize);
  if (data.length !== e.compressedSize) return null;
  let bytes: Uint8Array;
  if (e.method === 0) bytes = data;
  else if (e.method === 8) {
    if (budget.left <= 0) return null;
    try {
      bytes = inflateRawSync(data, { maxOutputLength: budget.left });
    } catch {
      return null; // corrupt, or it would inflate past what is left
    }
  } else return null;
  if (bytes.length > budget.left) return null;
  budget.left -= bytes.length;
  return xmlText(bytes);
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** An attribute value as an XML parser reads it: character references and the five predefined entities decoded. */
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== "#") return XML_ENTITIES[ref.toLowerCase()] ?? whole;
    const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

type XmlAttributes = Map<string, string[]>;

/**
 * Every `<[prefix:]name …>` element of `xml` with its attributes — keyed by LOCAL name, values entity-decoded, quotes
 * of either kind, a `>` inside a value never ends the tag. Not a parser: enough to find every attribute a real one
 * would, which is all a refusal needs.
 */
function elementsNamed(xml: string, name: string): XmlAttributes[] {
  const out: XmlAttributes[] = [];
  const open = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?=[\\s/>])`, "g");
  const attribute = /\s*([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  for (let m = open.exec(xml); m; m = open.exec(xml)) {
    const attrs: XmlAttributes = new Map();
    let i = m.index + m[0].length;
    for (;;) {
      attribute.lastIndex = i;
      const a = attribute.exec(xml);
      if (!a) break;
      const local = a[1].slice(a[1].indexOf(":") + 1);
      attrs.set(local, [...(attrs.get(local) ?? []), decodeXml(a[2] ?? a[3] ?? "")]);
      i = attribute.lastIndex;
    }
    out.push(attrs);
    open.lastIndex = Math.max(open.lastIndex, i);
  }
  return out;
}

const valuesOf = (a: XmlAttributes, key: string) => (a.get(key) ?? []).map((v) => v.trim());
const marked = (value: string, marks: readonly string[]) => marks.some((m) => value.toLowerCase().includes(m));

/** A part name as compared: `\` → `/`, percent-decoded, without a leading `/` or `./`, lower-case (OPC: ASCII case-insensitive). */
function partKey(name: string): string {
  let n = name.replace(/\\/g, "/");
  try {
    n = decodeURIComponent(n);
  } catch {
    /* not percent-encoded: compare it raw */
  }
  return n.replace(/^(?:\.?\/)+/, "").toLowerCase();
}

/** The content type [Content_Types].xml gives `part`: its one Override, else the one Default of its extension; null when absent or ambiguous. */
function effectiveType(part: string, defaults: XmlAttributes[], overrides: XmlAttributes[]): string | null {
  const own = overrides.filter((o) => valuesOf(o, "PartName").some((p) => partKey(p) === part)).flatMap((o) => valuesOf(o, "ContentType"));
  if (own.length > 0) return own.length === 1 ? own[0] : null;
  const ext = part.slice(part.lastIndexOf(".") + 1);
  const byExt = defaults.filter((d) => valuesOf(d, "Extension").some((x) => x.toLowerCase() === ext)).flatMap((d) => valuesOf(d, "ContentType"));
  return byExt.length === 1 ? byExt[0] : null;
}

/** A relationship's verdict: refused (macro / active content, an external target but a web / mail hyperlink) or null. */
function relationshipVerdict(r: XmlAttributes): SniffResult | null {
  const types = valuesOf(r, "Type").map((t) => t.toLowerCase());
  if (types.some((t) => marked(t, MACRO_REL_MARKS))) return MACRO;
  if (types.some((t) => marked(t, ACTIVE_REL_MARKS) || ACTIVE_REL_SUFFIXES.some((s) => t.endsWith(s)))) return ACTIVE;
  if (!valuesOf(r, "TargetMode").some((m) => m.toLowerCase() === "external")) return null;
  const targets = valuesOf(r, "Target");
  const hyperlink = types.length === 1 && types[0].endsWith(HYPERLINK_REL_SUFFIX);
  return hyperlink && targets.length === 1 && SAFE_HYPERLINK.test(targets[0]) ? null : ACTIVE;
}

async function ooxmlKind(src: ByteSource): Promise<SniffResult> {
  const zip = await readZip(src);
  if (!zip) return ZIP_REFUSED;
  const { entries, directoryOffset } = zip;
  if (entries.some((e) => (e.flags & 0x0001) !== 0)) return ZIP_REFUSED; // encrypted entry
  const keys = entries.map((e) => partKey(e.name));
  if (new Set(keys).size !== keys.length) return ZIP_REFUSED; // one part twice: which would Office read?
  if (keys.some((k) => marked(k, MACRO_PART_MARKS))) return MACRO;
  if (keys.some((k) => marked(k, ACTIVE_PART_MARKS) || ACTIVE_PART_SUFFIXES.some((s) => k.endsWith(s)))) return ACTIVE;

  const budget = { left: XML_BUDGET };
  const typesAt = keys.indexOf("[content_types].xml");
  if (typesAt < 0) return ZIP_REFUSED;
  const ct = await readXmlPart(src, entries[typesAt], directoryOffset, budget);
  if (ct === null) return ZIP_REFUSED;
  if (/macroenabled/i.test(ct)) return MACRO;
  const defaults = elementsNamed(ct, "Default");
  const overrides = elementsNamed(ct, "Override");
  const declared = [...defaults, ...overrides].flatMap((a) => valuesOf(a, "ContentType"));
  if (declared.some((t) => marked(t, MACRO_TYPE_MARKS))) return MACRO;
  if (declared.some((t) => marked(t, ACTIVE_TYPE_MARKS))) return ACTIVE;

  // Exactly one main part, of its own OOXML type, really in the archive (central directory AND local header).
  const mains = OOXML_MAIN.filter((m) => keys.includes(m.part));
  if (mains.length !== 1) return ZIP_REFUSED;
  const main = mains[0];
  if (effectiveType(main.part, defaults, overrides) !== main.type) return ZIP_REFUSED;
  if ((await localDataStart(src, entries[keys.indexOf(main.part)], directoryOffset)) === null) return ZIP_REFUSED;

  // Every relationship part, under the same budget; the package's own must name that main part as its document.
  let documents: string[] | null = null;
  for (let i = 0; i < entries.length; i++) {
    if (!keys[i].endsWith(".rels")) continue;
    const xml = await readXmlPart(src, entries[i], directoryOffset, budget);
    if (xml === null) return ZIP_REFUSED;
    const relationships = elementsNamed(xml, "Relationship");
    for (const r of relationships) {
      const refused = relationshipVerdict(r);
      if (refused) return refused;
    }
    if (keys[i] === "_rels/.rels") {
      documents = relationships.filter((r) => valuesOf(r, "Type").some((t) => t.toLowerCase().endsWith("/officedocument"))).flatMap((r) => valuesOf(r, "Target"));
    }
  }
  if (!documents || documents.length !== 1 || partKey(documents[0]) !== main.part) return ZIP_REFUSED;
  return { ok: true, kind: main.kind };
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
