import { describe, expect, it } from "vitest";
import { NEXT_PATH_MAX_LENGTH, safeNextPath } from "@/modules/iam/next-path";

describe("safeNextPath (the /login?next= deep link)", () => {
  it("accepts same-origin relative paths, with a query string", () => {
    expect(safeNextPath("/inbox/0199b000-0000-7000-8000-000000000001")).toBe("/inbox/0199b000-0000-7000-8000-000000000001");
    expect(safeNextPath("/inbox?tab=done&mine=1")).toBe("/inbox?tab=done&mine=1");
    expect(safeNextPath("/admin/people/abc#roles")).toBe("/admin/people/abc#roles");
  });
  it.each([
    ["https://evil.example/inbox", "absolute URL"],
    ["//evil.example/inbox", "protocol-relative"],
    ["/\\evil.example", "backslash protocol-relative"],
    ["/inbox\\..\\x", "backslash inside"],
    ["javascript:alert(1)", "scheme"],
    ["inbox/1", "no leading slash"],
    ["/", "bare root (nothing to return to)"],
    ["/inbox/1\n", "control character"],
    ["/inbox/ 1", "whitespace"],
    ["/login?next=/x", "the login page itself (loop)"],
    ["/change-password", "the change-password page (loop)"],
    ["/change-password/x", "under the change-password page"],
    ["", "empty"],
    ["/" + "a".repeat(NEXT_PATH_MAX_LENGTH), "too long"],
  ])("rejects %s (%s)", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
  it("rejects non-strings (arrays from repeated query params, undefined)", () => {
    expect(safeNextPath(["/inbox", "/home"])).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
