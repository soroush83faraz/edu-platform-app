// The magic-byte sniffer (src/modules/files/sniff.ts): a file's kind comes from its bytes — never its name or the
// client's Content-Type — and whatever is not positively an allowed kind is refused. OOXML is decided from the ZIP
// central directory plus ONE capped [Content_Types].xml, so nothing is ever unpacked (a bomb cannot expand).
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bufferSource, signatureKind, sniffKind } from "@/modules/files/sniff";

const sniff = (b: Uint8Array | string) => sniffKind(bufferSource(typeof b === "string" ? Buffer.from(b, "utf8") : b));
const bytes = (...parts: Array<number[] | string | Buffer>) =>
  Buffer.concat(parts.map((p) => (Array.isArray(p) ? Buffer.from(p) : typeof p === "string" ? Buffer.from(p, "latin1") : p)));

interface Entry {
  name: string;
  data: string | Buffer;
  deflate?: boolean;
  flags?: number;
  /** Lie in the central directory about the inflated size (a bomb's trick). */
  declaredSize?: number;
}

/** A minimal ZIP writer (local headers, central directory, end record) — CRCs are not checked by the sniffer. */
function zip(entries: Entry[], opts: { cutEnd?: number; comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const comp = e.deflate ? deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.declaredSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const dir = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const all = Buffer.concat([...locals, dir, end, comment]);
  return opts.cutEnd ? all.subarray(0, all.length - opts.cutEnd) : all;
}

const MAIN = {
  docx: { part: "word/document.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" },
  xlsx: { part: "xl/workbook.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" },
  pptx: { part: "ppt/presentation.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" },
} as const;

const contentTypes = (part: string, type: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/${part}" ContentType="${type}"/></Types>`;

function office(kind: keyof typeof MAIN, opts: { deflate?: boolean; extra?: Entry[]; ct?: string } = {}): Buffer {
  const m = MAIN[kind];
  return zip([
    { name: "[Content_Types].xml", data: opts.ct ?? contentTypes(m.part, m.type), deflate: opts.deflate },
    { name: "_rels/.rels", data: "<Relationships/>", deflate: opts.deflate },
    { name: m.part, data: "<doc/>", deflate: opts.deflate },
    ...(opts.extra ?? []),
  ]);
}

describe("sniffKind — binary signatures", () => {
  it("recognises PDF, PNG (with IHDR), JPEG, WebP, WAV, OGG, M4A and MP3 by their bytes", async () => {
    expect(await sniff(bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toEqual({ ok: true, kind: "pdf" });
    expect(await sniff(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [0, 0, 0, 1]))).toEqual({ ok: true, kind: "png" });
    expect(await sniff(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF"))).toEqual({ ok: true, kind: "jpeg" });
    expect(await sniff(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ", [0, 0, 0, 0]))).toEqual({ ok: true, kind: "webp" });
    expect(await sniff(bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt ", [16, 0, 0, 0]))).toEqual({ ok: true, kind: "wav" });
    expect(await sniff(bytes("OggS", [0, 2, 0, 0]))).toEqual({ ok: true, kind: "ogg" });
    expect(await sniff(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0]))).toEqual({ ok: true, kind: "m4a" });
    expect(await sniff(bytes("ID3", [4, 0, 0, 0, 0, 0, 0]))).toEqual({ ok: true, kind: "mp3" });
    expect(await sniff(bytes([0xff, 0xfb, 0x90, 0x64, 0, 0]))).toEqual({ ok: true, kind: "mp3" });
  });

  it("refuses look-alikes: a PNG signature without IHDR, an AAC (ADTS) frame, a QuickTime ftyp, an AVI, an executable", async () => {
    expect((await sniff(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "XXXX", [0, 0])))).toMatchObject({ ok: false });
    expect(signatureKind(bytes([0xff, 0xf1, 0x50, 0x80]))).toBeNull();
    expect((await sniff(bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 0, 0])))).toMatchObject({ ok: false });
    expect((await sniff(bytes("RIFF", [0x24, 0, 0, 0], "AVI LIST")))).toMatchObject({ ok: false });
    expect(await sniff(bytes("MZ", [0x90, 0, 3, 0, 0, 0, 4, 0], "This program cannot be run in DOS mode"))).toEqual({ ok: false, reason: "unknown" });
    expect(await sniff(bytes([0x7f], "ELF", [2, 1, 1, 0]))).toMatchObject({ ok: false });
  });

  it("an empty file is refused", async () => {
    expect(await sniff(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
  });
});

describe("sniffKind — spoofed names and markup", () => {
  it("HTML saved as «.png», SVG, XML and an HTML comment are refused as markup (the name never counts)", async () => {
    expect(await sniff("<!DOCTYPE html><html><script>alert(1)</script></html>")).toEqual({ ok: false, reason: "markup" });
    expect(await sniff('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')).toEqual({ ok: false, reason: "markup" });
    expect(await sniff('<?xml version="1.0"?><svg/>')).toEqual({ ok: false, reason: "markup" });
    expect(await sniff("﻿ \n\t<!-- x --><script>")).toEqual({ ok: false, reason: "markup" });
  });

  it("a script with a shebang is refused; plain Persian text (with or without a BOM) is text", async () => {
    expect(await sniff("#!/bin/sh\nrm -rf /\n")).toEqual({ ok: false, reason: "script" });
    expect(await sniff("پاسخ تمرین صفحهٴ ۴۲\nسطر دوم\t۱۲۳\r\n")).toEqual({ ok: true, kind: "txt" });
    expect(await sniff("﻿سلام")).toEqual({ ok: true, kind: "txt" });
    expect(await sniff("a,b,c\n1,2,3\n")).toEqual({ ok: true, kind: "txt" });
  });

  it("text that is not clean UTF-8 is refused: invalid bytes, a sequence cut off at the end, NUL, other controls, white space only", async () => {
    expect(await sniff(bytes("abc", [0xc3, 0x28], "def"))).toEqual({ ok: false, reason: "encoding" });
    expect(await sniff(bytes("سلا", [0xd9]))).toEqual({ ok: false, reason: "encoding" });
    expect(await sniff(bytes("ab", [0], "cd"))).toEqual({ ok: false, reason: "unknown" });
    expect(await sniff(bytes("ab", [0x1b], "[31mred"))).toEqual({ ok: false, reason: "control" });
    expect(await sniff(" \n\t \r\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("validates the WHOLE text, not only its head (a binary tail after 100 KB of text is refused)", async () => {
    const big = Buffer.concat([Buffer.from("ا".repeat(60_000), "utf8"), Buffer.from([0x00, 0x01, 0x02])]);
    expect(await sniff(big)).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("sniffKind — OOXML through the ZIP directory (nothing unpacked)", () => {
  it("DOCX, XLSX and PPTX are recognised, stored or deflated", async () => {
    for (const kind of ["docx", "xlsx", "pptx"] as const) {
      expect(await sniff(office(kind)), kind).toEqual({ ok: true, kind });
      expect(await sniff(office(kind, { deflate: true })), `${kind} deflated`).toEqual({ ok: true, kind });
    }
    // An archive comment does not hide the end record.
    const m = MAIN.docx;
    const commented = zip([{ name: "[Content_Types].xml", data: contentTypes(m.part, m.type) }, { name: m.part, data: "<d/>" }], { comment: "ساخته‌شده با ویرایشگر" });
    expect(await sniff(commented)).toEqual({ ok: true, kind: "docx" });
  });

  it("a plain ZIP renamed «.docx» (no [Content_Types].xml), a main part without its content type, and a mixed archive are refused", async () => {
    expect(await sniff(zip([{ name: "word/document.xml", data: "<doc/>" }, { name: "evil.exe", data: "MZ" }]))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(office("docx", { ct: contentTypes("word/document.xml", "application/xml") }))).toEqual({ ok: false, reason: "zip" });
    expect(
      await sniff(office("docx", { extra: [{ name: "xl/workbook.xml", data: "<wb/>" }] })),
    ).toEqual({ ok: false, reason: "zip" });
  });

  it("macro documents are refused — a vbaProject.bin, or a macroEnabled type in [Content_Types].xml", async () => {
    expect(await sniff(office("docx", { extra: [{ name: "word/vbaProject.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }] }))).toEqual({ ok: false, reason: "macro" });
    expect(await sniff(office("xlsx", { ct: contentTypes("xl/workbook.xml", "application/vnd.ms-excel.sheet.macroEnabled.main+xml") }))).toEqual({ ok: false, reason: "macro" });
  });

  it("an encrypted entry, a truncated archive, an unknown method and a lying [Content_Types].xml (inflates past the cap) are refused", async () => {
    const m = MAIN.docx;
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: contentTypes(m.part, m.type), flags: 1 }, { name: m.part, data: "<d/>" }]))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(office("docx", { deflate: true }).subarray(0, 200))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: contentTypes(m.part, m.type) }, { name: m.part, data: "<d/>" }], { cutEnd: 5 }))).toEqual({ ok: false, reason: "zip" });
    // ~2 MiB of the content type repeated deflates to a few KB but declares 1 KB: the 1 MiB output cap stops it.
    const bomb = Buffer.from(contentTypes(m.part, m.type).repeat(8000), "utf8");
    expect(bomb.length).toBeGreaterThan(1024 * 1024);
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: bomb, deflate: true, declaredSize: 1024 }, { name: m.part, data: "<d/>" }]))).toEqual({ ok: false, reason: "zip" });
  });
});
