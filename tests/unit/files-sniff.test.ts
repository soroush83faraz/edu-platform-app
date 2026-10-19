// The magic-byte sniffer (src/modules/files/sniff.ts): a file's kind comes from its bytes — never its name or the
// client's Content-Type — and whatever is not positively an allowed kind is refused. OOXML is decided from the ZIP
// central directory plus its small XML parts ([Content_Types].xml and every .rels) under ONE inflate cap, so nothing
// else is ever unpacked (a bomb cannot expand). The security review's crafted documents (2026-10-19, D5) are below:
// a VBA project under another name, an external template, an embedded OLE object, a central-directory-only main part.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ACCEPT_ATTRIBUTE, KIND_INFO } from "@/modules/files/kinds";
import { nameForKind } from "@/modules/files/names";
import { fileResponseHeaders } from "@/modules/files/serve";
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
  /** Only in the central directory: its local offset points at another entry's local header (index into `entries`). */
  localOf?: number;
  /** A different name in the local header than in the central directory. */
  localName?: string;
}

/** A minimal ZIP writer (local headers, central directory, end record) — CRCs are not checked by the sniffer. */
function zip(entries: Entry[], opts: { cutEnd?: number; comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const comp = e.deflate ? deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;
    const name = Buffer.from(e.name, "utf8");
    offsets.push(offset);
    if (e.localOf === undefined) {
      const localName = Buffer.from(e.localName ?? e.name, "utf8");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(e.flags ?? 0, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(localName.length, 26);
      locals.push(local, localName, comp);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.declaredSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.localOf === undefined ? offset : offsets[e.localOf], 42);
    centrals.push(central, name);
    if (e.localOf === undefined) offset += 30 + Buffer.byteLength(e.localName ?? e.name, "utf8") + comp.length;
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

const contentTypes = (part: string, type: string, more = "") =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/${part}" ContentType="${type}"/>${more}</Types>`;

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (...items: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
const rel = (id: string, type: string, target: string, mode?: string) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`;
/** The package's own relationships, as every producer writes them: the main part is its officeDocument. */
const rootRels = (part: string) => rels(rel("rId1", "officeDocument", part), `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`);

function office(kind: keyof typeof MAIN, opts: { deflate?: boolean; extra?: Entry[]; ct?: string; root?: string } = {}): Buffer {
  const m = MAIN[kind];
  return zip([
    { name: "[Content_Types].xml", data: opts.ct ?? contentTypes(m.part, m.type), deflate: opts.deflate },
    { name: "_rels/.rels", data: opts.root ?? rootRels(m.part), deflate: opts.deflate },
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
    const commented = zip([{ name: "[Content_Types].xml", data: contentTypes(m.part, m.type) }, { name: "_rels/.rels", data: rootRels(m.part) }, { name: m.part, data: "<d/>" }], { comment: "ساخته‌شده با ویرایشگر" });
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

describe("sniffKind — OOXML that makes Office run code or reach out (security review D5)", () => {
  const W = MAIN.docx;
  const docx = (opts: { more?: string; extra?: Entry[]; deflate?: boolean } = {}) => office("docx", { ct: contentTypes(W.part, W.type, opts.more ?? ""), extra: opts.extra, deflate: opts.deflate });
  const vba = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

  it("a VBA project under another name is a macro — declared by an Override, by a Default, entity-encoded, or related from the document", async () => {
    expect(await sniff(docx({ more: `<Override PartName="/word/m.bin" ContentType="application/vnd.ms-office.vbaProject"/>`, extra: [{ name: "word/m.bin", data: vba }] }))).toEqual({ ok: false, reason: "macro" });
    expect(await sniff(docx({ more: `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>`, extra: [{ name: "word/m.bin", data: vba }] }))).toEqual({ ok: false, reason: "macro" });
    expect(await sniff(docx({ more: `<Override PartName="/word/m.bin" ContentType="application/vnd.ms-office.vba&#80;roject"/>`, extra: [{ name: "word/m.bin", data: vba }], deflate: true }))).toEqual({ ok: false, reason: "macro" });
    const fromDocument = rels(`<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="m.bin"/>`);
    expect(await sniff(docx({ extra: [{ name: "word/_rels/document.xml.rels", data: fromDocument }, { name: "word/m.bin", data: vba }] }))).toEqual({ ok: false, reason: "macro" });
  });

  it("an external relationship is refused — the audit's attached template, an OLE link, a linked image, a frame — also entity-encoded or deflated", async () => {
    const settings = (r: string) => docx({ extra: [{ name: "word/_rels/settings.xml.rels", data: rels(r), deflate: true }] });
    expect(await sniff(settings(rel("rId1", "attachedTemplate", "https://evil.example/t.dotm", "External")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(rel("rId1", "attachedTemplate", "file:///C:/Templates/Normal.dotm", "External")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(rel("rId1", "oleObject", "https://evil.example/x.html!", "External")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(rel("rId1", "image", "http://tracker.example/pixel.png", "External")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(rel("rId1", "image", "http://tracker.example/pixel.png", "&#69;xternal")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(`<Relationship Id='rId1' TargetMode = 'External' Type='${REL}/frame' Target='http://evil.example/'/>`))).toEqual({ ok: false, reason: "active" });
    // A `>` inside an attribute value does not end the tag before TargetMode.
    expect(await sniff(settings(`<Relationship Id="rId1" Type="${REL}/image" Target="a>b" TargetMode="External"/>`))).toEqual({ ok: false, reason: "active" });
    // Relationship types that pull content in, whatever their target.
    expect(await sniff(settings(rel("rId1", "aFChunk", "chunk.rtf")))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(settings(rel("rId1", "subDocument", "sub.docx")))).toEqual({ ok: false, reason: "active" });
  });

  it("a hyperlink to the web or a mail address stays; one to a file, a share or an app protocol does not", async () => {
    const links = (target: string) => docx({ extra: [{ name: "word/_rels/document.xml.rels", data: rels(rel("rId5", "hyperlink", target, "External")) }] });
    expect(await sniff(links("https://www.example.ir/درس"))).toEqual({ ok: true, kind: "docx" });
    expect(await sniff(links("mailto:teacher@example.ir"))).toEqual({ ok: true, kind: "docx" });
    for (const t of ["file:///C:/Windows/System32/calc.exe", "\\\\attacker\\share\\x", "ms-msdt:/id PCWDiagnostic", "search-ms:query=x", "javascript:alert(1)"]) {
      expect(await sniff(links(t)), t).toEqual({ ok: false, reason: "active" });
    }
  });

  it("embedded and active objects are refused: an OLE object, a workbook behind a chart, ActiveX, external links, data connections", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await sniff(docx({ more: `<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>`, extra: [{ name: "word/embeddings/oleObject1.bin", data: ole }] }))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(docx({ extra: [{ name: "word/embeddings/Microsoft_Excel_Worksheet.xlsx", data: "PK" }] }))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(docx({ more: `<Override PartName="/word/blob.dat" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>`, extra: [{ name: "word/blob.dat", data: ole }] }))).toEqual({ ok: false, reason: "active" });
    expect(await sniff(docx({ extra: [{ name: "word/activeX/activeX1.xml", data: "<ax/>" }] }))).toEqual({ ok: false, reason: "active" });
    const X = MAIN.xlsx;
    expect(await sniff(office("xlsx", { extra: [{ name: "xl/externalLinks/externalLink1.xml", data: "<e/>" }] }))).toEqual({ ok: false, reason: "active" });
    const connections = `<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>`;
    expect(await sniff(office("xlsx", { ct: contentTypes(X.part, X.type, connections), extra: [{ name: "xl/connections.xml", data: "<c/>" }] }))).toEqual({ ok: false, reason: "active" });
  });

  it("the main part must be real: in the central directory AND a matching local header, the package's officeDocument, unique", async () => {
    const ct = contentTypes(W.part, W.type);
    // The audit's case: the central directory lists word/document.xml, its offset is [Content_Types].xml's header.
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: ct }, { name: "_rels/.rels", data: rootRels(W.part) }, { name: W.part, data: "<doc/>", localOf: 0 }]))).toEqual({ ok: false, reason: "zip" });
    // Another name in the local header (what a streaming reader would see).
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: ct }, { name: "_rels/.rels", data: rootRels(W.part) }, { name: W.part, data: "<doc/>", localName: "word/documenT.xml" }]))).toEqual({ ok: false, reason: "zip" });
    // No package relationship, or one that names another part as the document; a leading `/` is the same part.
    expect(await sniff(zip([{ name: "[Content_Types].xml", data: ct }, { name: W.part, data: "<doc/>" }]))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(office("docx", { root: rootRels("word/other.xml") }))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(office("docx", { root: rootRels("/word/document.xml") }))).toEqual({ ok: true, kind: "docx" });
    // The same part twice (which one would Office read?).
    expect(await sniff(office("docx", { extra: [{ name: "WORD/Document.xml", data: "<evil/>" }] }))).toEqual({ ok: false, reason: "zip" });
  });

  it("XML parts must be UTF-8 without a DTD, and all of them together inflate to at most 1 MiB", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rels(rel("rId1", "attachedTemplate", "https://evil.example/t.dotm", "External")), "utf16le")]);
    expect(await sniff(docx({ extra: [{ name: "word/_rels/settings.xml.rels", data: utf16 }] }))).toEqual({ ok: false, reason: "zip" });
    const dtd = `<!DOCTYPE r [<!ENTITY m "External">]>` + rels(rel("rId1", "image", "http://x.example/a.png", "&m;"));
    expect(await sniff(docx({ extra: [{ name: "word/_rels/document.xml.rels", data: dtd }] }))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(docx({ extra: [{ name: "word/_rels/document.xml.rels", data: rels().replace('encoding="UTF-8"', 'encoding="windows-1256"') }] }))).toEqual({ ok: false, reason: "zip" });
    // 300 relationship parts of ~4 KiB each: far under the per-part cap, over the budget they share.
    const slideRels = rels(...Array.from({ length: 40 }, (_, j) => rel(`rId${j}`, "image", `../media/image${j}.png`)));
    const many: Entry[] = Array.from({ length: 300 }, (_, i) => ({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels, deflate: true }));
    expect(await sniff(office("pptx", { extra: many }))).toEqual({ ok: false, reason: "zip" });
    expect(await sniff(office("pptx", { extra: many.slice(0, 20) }))).toEqual({ ok: true, kind: "pptx" });
  });

  it("an ordinary document — images, a web hyperlink, printer settings, custom XML, core properties — is still a document", async () => {
    const more =
      `<Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`;
    const doc = office("docx", {
      ct: contentTypes(W.part, W.type, more),
      deflate: true,
      extra: [
        { name: "word/_rels/document.xml.rels", data: rels(rel("rId1", "image", "media/image1.png"), rel("rId2", "hyperlink", "https://www.example.ir/?a=1&amp;b=2", "External"), rel("rId3", "styles", "styles.xml")), deflate: true },
        { name: "word/media/image1.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        { name: "word/printerSettings/printerSettings1.bin", data: Buffer.from([1, 2, 3]) },
        { name: "customXml/item1.xml", data: "<x/>" },
        { name: "docProps/core.xml", data: "<cp:coreProperties/>" },
      ],
    });
    expect(await sniff(doc)).toEqual({ ok: true, kind: "docx" });
  });
});

describe("plain text is always stored and served as .txt (D5: no spreadsheet runs a `=cmd|…` cell from it)", () => {
  it("a formula-looking «.csv» is text, renamed «.txt», downloaded as text/plain", async () => {
    const payload = "=cmd|' /C calc'!A0,1\n+SUM(1+1)*cmd|' /C calc'!A0\n@SUM(1)\n-2+3\n";
    expect(await sniff(payload)).toEqual({ ok: true, kind: "txt" });
    expect(KIND_INFO.txt.extensions).toEqual(["txt"]);
    expect(nameForKind("نمرات.csv", "txt")).toBe("نمرات.txt");
    expect(nameForKind("notes.md", "txt")).toBe("notes.txt");
    const h = fileResponseHeaders("txt", nameForKind("x.csv", "txt"), payload.length);
    expect(h["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(h["Content-Disposition"]).toMatch(/^attachment; filename="x\.txt"/);
    // The picker still offers them (the server renames).
    expect(ACCEPT_ATTRIBUTE.split(",")).toEqual(expect.arrayContaining([".txt", ".csv", ".md", "text/csv"]));
  });
});
