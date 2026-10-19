// The file surfaces of a تکلیف, rendered statically and read as strings: the download rows (`FileRows`), the giver's
// «پاسخ‌های دانش‌آموزان» (`SubmissionsOverview`) and the student's «پاسخ شما» (`SubmissionCard`) — links point at
// /files/<id> only, images open in place, everything else downloads, the counts and the «not yet» list, read-only once
// closed, and no Latin word of our own in the UI.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/modules/workspace/actions", () => ({ saveSubmissionAction: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));

const { FileRows } = await import("@/modules/files/ui/FileRows");
const { SubmissionsOverview } = await import("@/modules/workspace/ui/SubmissionsOverview");
const { SubmissionCard } = await import("@/modules/workspace/ui/SubmissionCard");

const PDF = { id: "0199a000-0000-7000-8000-0000000000f1", name: "کاربرگ.pdf", sizeBytes: 2.5 * 1024 * 1024, kind: "pdf" as const };
const IMG = { id: "0199a000-0000-7000-8000-0000000000f2", name: "عکس.jpg", sizeBytes: 300 * 1024, kind: "jpeg" as const };
const t0 = new Date("2026-10-19T08:00:00Z");
const t1 = new Date("2026-10-19T09:00:00Z");

describe("FileRows", () => {
  it("each row is the download link /files/<id>: images open in a new tab, everything else downloads; kind and size in Persian", () => {
    const html = renderToStaticMarkup(createElement(FileRows, { files: [PDF, IMG] }));
    expect(html).toContain(`href="/files/${PDF.id}"`);
    expect(html).toContain(`href="/files/${IMG.id}"`);
    expect(html).toMatch(new RegExp(`href="/files/${IMG.id}"[^>]*target="_blank"`));
    expect(html).toMatch(new RegExp(`href="/files/${PDF.id}"[^>]*download=""`));
    expect(html).toContain("پی‌دی‌اف · ۲٫۵ مگابایت");
    expect(html).toContain("تصویر · ۳۰۰ کیلوبایت");
    expect(renderToStaticMarkup(createElement(FileRows, { files: [] }))).toBe("");
  });
});

describe("SubmissionsOverview («پاسخ‌های دانش‌آموزان»)", () => {
  it("«n از m تحویل داده‌اند», each پاسخ with its preview and files, a removed student tagged, the not-yet list", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsOverview, {
        overview: {
          assigneeCount: 2,
          submittedCount: 1,
          submissions: [
            { id: "s1", studentPersonId: "p1", studentName: "لیلا نیک‌خواه", studentRemoved: false, body: "پاسخ تمرین ۳", submittedAt: t0, updatedAt: t1, files: [{ ...PDF, addedAt: t0 }] },
            { id: "s2", studentPersonId: "p9", studentName: "رها شریفی", studentRemoved: true, body: null, submittedAt: t0, updatedAt: t0, files: [{ ...IMG, addedAt: t0 }] },
          ],
          missing: [{ personId: "p3", name: "نگار رستمی" }],
        },
      }),
    );
    expect(html).toContain("پاسخ‌های دانش‌آموزان");
    expect(html).toContain("۱ از ۲ تحویل داده‌اند");
    expect(html).toContain("لیلا نیک‌خواه");
    expect(html).toContain("پاسخ تمرین ۳");
    expect(html).toContain("حذف‌شده");
    expect(html).toContain("۱ فایل، بدون متن");
    expect(html).toContain("هنوز تحویل نداده‌اند");
    expect(html).toContain("نگار رستمی");
    expect(html).toContain(`href="/files/${PDF.id}"`);
  });

  it("nobody has answered yet: the empty state names the context", () => {
    const html = renderToStaticMarkup(createElement(SubmissionsOverview, { overview: { assigneeCount: 3, submittedCount: 0, submissions: [], missing: [] } }));
    expect(html).toContain("هنوز پاسخی برای این تکلیف ثبت نشده است.");
    expect(html).toContain("۰ از ۳ تحویل داده‌اند");
  });
});

describe("SubmissionCard («پاسخ شما»)", () => {
  const base = { workItemId: "0199a000-0000-7000-8000-000000000001", uploadsBlocked: false, myDone: false };

  it("nothing sent yet and open: the form straight away — text, «افزودن فایل», «ثبت پاسخ»", () => {
    const html = renderToStaticMarkup(createElement(SubmissionCard, { ...base, submission: null, canSubmit: true }));
    expect(html).toContain("پاسخ شما");
    expect(html).toContain("متن پاسخ");
    expect(html).toContain("افزودن فایل");
    expect(html).toContain("ثبت پاسخ");
    expect(html).toContain('type="file"');
  });

  it("sent and open: the text, the files and «ویرایش پاسخ»; closed: read-only with the reason", () => {
    const submission = { body: "پاسخ من", submittedAt: t0, updatedAt: t1, files: [PDF] };
    const open = renderToStaticMarkup(createElement(SubmissionCard, { ...base, submission, canSubmit: true }));
    expect(open).toContain("پاسخ من");
    expect(open).toContain("ویرایش پاسخ");
    expect(open).toContain(`href="/files/${PDF.id}"`);
    expect(open).not.toContain('type="file"');
    const closed = renderToStaticMarkup(createElement(SubmissionCard, { ...base, submission, canSubmit: false }));
    expect(closed).not.toContain("ویرایش پاسخ");
    expect(closed).toContain("این تکلیف بسته شده است؛ پاسخ دیگر ویرایش نمی‌شود.");
  });

  it("a «ورود آزمایشی» session writes text but uploads nothing", () => {
    const html = renderToStaticMarkup(createElement(SubmissionCard, { ...base, submission: null, canSubmit: true, uploadsBlocked: true }));
    expect(html).not.toContain('type="file"');
    expect(html).toContain("در ورود آزمایشی بارگذاری فایل ممکن نیست");
  });
});
