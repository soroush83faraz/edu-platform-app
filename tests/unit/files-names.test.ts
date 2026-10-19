// Upload names (src/modules/files/names.ts) and storage keys (src/modules/files/paths.ts): a client's file name is
// display text only — sanitised, length-capped, its extension forced to the sniffed kind's — and never part of a path.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentDisposition, decodeHeaderName, nameForKind, sanitizeFileName } from "@/modules/files/names";
import { STORAGE_KEY_RE, storageKeyFor, storagePathIn, tempDirIn } from "@/modules/files/paths";
import { FILE_LIMITS } from "@/modules/files/limits";

const ORG = "0199a000-0000-7000-8000-00000000000a";
const FILE = "0199a000-0000-7000-8000-0000000000f1";

describe("sanitizeFileName", () => {
  it("keeps only the last path segment («C:\\fakepath\\…», «../../…»)", () => {
    expect(sanitizeFileName("C:\\fakepath\\تمرین ریاضی.pdf")).toBe("تمرین ریاضی.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b\\c/../d.txt")).toBe("d.txt");
  });

  it("removes control, bidi-override and invisible characters but keeps the Persian half-space (ZWNJ)", () => {
    expect(sanitizeFileName("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeFileName("a\u2066b\u2069c\u200Fd\u061Ce.txt")).toBe("abcde.txt");
    expect(sanitizeFileName("x\u0000y\u0007z\r\n.txt")).toBe("xyz.txt");
    expect(sanitizeFileName("\uFEFFz\u200Bw.txt")).toBe("zw.txt");
    expect(sanitizeFileName("نامه\u200Cی من.docx")).toBe("نامه\u200Cی من.docx");
  });

  it("replaces Windows-illegal characters, trims dots and spaces, guards device names, collapses white space", () => {
    expect(sanitizeFileName('a<b>:c"d|e?f*.txt')).toBe("a_b__c_d_e_f_.txt");
    expect(sanitizeFileName("   ...hidden.txt...  ")).toBe("hidden.txt");
    expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFileName("nul")).toBe("_nul");
    expect(sanitizeFileName("a   \t b.pdf")).toBe("a b.pdf");
  });

  it("refuses a name with nothing usable left; caps long names in code points and keeps the extension", () => {
    expect(sanitizeFileName("")).toBeNull();
    expect(sanitizeFileName(" ... ")).toBeNull();
    expect(sanitizeFileName("\u202E\u200B")).toBeNull();
    const long = sanitizeFileName(`${"ب".repeat(500)}.pdf`)!;
    expect([...long].length).toBe(FILE_LIMITS.maxNameChars);
    expect(long.endsWith(".pdf")).toBe(true);
  });
});

describe("nameForKind — the extension follows the sniffed bytes", () => {
  it("keeps an allowed extension (lower-cased), replaces a mismatched one, adds a missing one", () => {
    expect(nameForKind("photo.PNG", "png")).toBe("photo.png");
    expect(nameForKind("a.JPEG", "jpeg")).toBe("a.jpeg");
    expect(nameForKind("photo.png", "jpeg")).toBe("photo.jpg");
    expect(nameForKind("notes.html", "txt")).toBe("notes.txt");
    expect(nameForKind("noext", "pdf")).toBe("noext.pdf");
    expect(nameForKind("data.csv", "txt")).toBe("data.csv");
  });

  it("double extensions: a real PDF named «x.pdf.exe» is «x.pdf», never «.exe»", () => {
    expect(nameForKind("تمرین.pdf.exe", "pdf")).toBe("تمرین.pdf");
    expect(nameForKind("cat.jpg.html", "jpeg")).toBe("cat.jpg");
    expect(nameForKind("report.docx.js", "docx")).toBe("report.docx");
  });
});

describe("decodeHeaderName", () => {
  it("decodes the percent-encoded header; refuses raw non-ASCII, malformed escapes and oversize values", () => {
    expect(decodeHeaderName(encodeURIComponent("تمرین ۱.pdf"))).toBe("تمرین ۱.pdf");
    expect(decodeHeaderName("تمرین.pdf")).toBeNull();
    expect(decodeHeaderName("%E0%A4%A")).toBeNull();
    expect(decodeHeaderName("%FF")).toBeNull();
    expect(decodeHeaderName("a".repeat(3000))).toBeNull();
    expect(decodeHeaderName(null)).toBeNull();
    expect(decodeHeaderName("")).toBeNull();
  });
});

describe("contentDisposition", () => {
  it("an ASCII fallback plus the RFC 5987 UTF-8 name; never a CR/LF/quote that could split the header", () => {
    const h = contentDisposition("attachment", "تمرین ۱.pdf");
    expect(h.startsWith('attachment; filename="file.pdf"; filename*=UTF-8\'\'')).toBe(true);
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe("تمرین ۱.pdf");
    const tricky = contentDisposition("inline", "a'b(c)\"d\\e;f%g\r\nX-Evil: 1.png");
    expect(tricky).not.toMatch(/[\r\n]/);
    expect(tricky.split(";")[0]).toBe("inline");
    expect(tricky).toContain("%27");
    expect(tricky).toContain("%28");
    const fallback = tricky.match(/filename="([^"]*)"/)![1];
    expect(fallback).not.toMatch(/["\\%;]/);
  });
});

describe("storage keys", () => {
  it("is <org>/<year>/<file id>, lower-case, from server values only", () => {
    const key = storageKeyFor(ORG.toUpperCase(), FILE, new Date("2026-10-19T08:00:00Z"));
    expect(key).toBe(`${ORG}/2026/${FILE}`);
    expect(STORAGE_KEY_RE.test(key)).toBe(true);
    expect(() => storageKeyFor("../x", FILE, new Date())).toThrow();
    expect(() => storageKeyFor(ORG, "x.pdf", new Date())).toThrow();
  });

  it("resolves strictly under the root and refuses every other shape (traversal, separators, absolute)", () => {
    const root = path.resolve("tmp-files-root");
    const key = `${ORG}/2026/${FILE}`;
    expect(storagePathIn(root, key)).toBe(path.join(root, ORG, "2026", FILE));
    for (const bad of [`../${ORG}/2026/${FILE}`, `${ORG}/2026/../${FILE}`, `${ORG}\\2026\\${FILE}`, `/${ORG}/2026/${FILE}`, `${ORG}/2026/${FILE}.pdf`, `${ORG}/26/${FILE}`, ""]) {
      expect(() => storagePathIn(root, bad), bad).toThrow();
    }
    expect(tempDirIn(root)).toBe(path.join(root, ".tmp"));
  });
});
