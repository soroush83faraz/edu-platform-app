// What POST /api/files reads before anything else (src/modules/files/upload-request.ts): the same-origin lock (CSRF)
// and exactly three inputs — nothing else of the request reaches the gate.
import { describe, expect, it } from "vitest";
import { isSameOriginUpload, readUploadRequest } from "@/modules/files/upload-request";

const ORIGIN = "https://school.example.ir";
const h = (entries: Record<string, string>) => new Headers(entries);

describe("isSameOriginUpload", () => {
  it("accepts the app's own origin, with or without Sec-Fetch-Site: same-origin", () => {
    expect(isSameOriginUpload(h({ origin: ORIGIN, "sec-fetch-site": "same-origin" }), ORIGIN)).toBe(true);
    expect(isSameOriginUpload(h({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(isSameOriginUpload(h({ origin: "http://localhost:3000" }), "http://localhost:3000")).toBe(true);
  });

  it("refuses a missing Origin, another origin (scheme, port, sibling host) and any cross-site fetch", () => {
    expect(isSameOriginUpload(h({}), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: "null" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: "https://evil.example" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: "http://school.example.ir" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: "https://school.example.ir:8443" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: "https://a.school.example.ir" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: ORIGIN, "sec-fetch-site": "same-site" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: ORIGIN, "sec-fetch-site": "cross-site" }), ORIGIN)).toBe(false);
    expect(isSameOriginUpload(h({ origin: ORIGIN, "sec-fetch-site": "none" }), ORIGIN)).toBe(false);
  });
});

describe("readUploadRequest", () => {
  it("takes purpose and workItemId from the query and the decoded name from X-File-Name — nothing else", () => {
    const q = new URLSearchParams({ purpose: "submission", workItemId: "0199a000-0000-7000-8000-000000000001", organizationId: "x", storageKey: "../../etc" });
    const r = readUploadRequest(q, h({ "x-file-name": encodeURIComponent("پاسخ من.pdf"), "content-length": "1234" }));
    expect(r.meta).toEqual({ purpose: "submission", workItemId: "0199a000-0000-7000-8000-000000000001", name: "پاسخ من.pdf" });
    expect(r.announcedBytes).toBe(1234);
  });

  it("an undecodable name, a missing one and a malformed Content-Length are simply absent (the strict gate refuses them)", () => {
    expect(readUploadRequest(new URLSearchParams({ purpose: "work_item" }), h({ "x-file-name": "%E0%A4%A", "content-length": "12abc" }))).toEqual({ meta: { purpose: "work_item" }, announcedBytes: null });
    expect(readUploadRequest(new URLSearchParams(), h({})).meta).toEqual({});
    expect(readUploadRequest(new URLSearchParams(), h({ "content-length": "-5" })).announcedBytes).toBeNull();
  });
});
