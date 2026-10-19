// «اولیا» — the pure rules (src/modules/iam/guardian-policy.ts): relations, which child a guardian page shows, the
// generated username, the bulk placeholder name, the demo dock labels and the bell's titles (no extra text).
import { describe, expect, it } from "vitest";
import {
  BULK_RELATION,
  GUARDIAN_RELATIONS,
  RELATION_LABELS,
  childHref,
  childParam,
  guardianDemoLabel,
  guardianNotificationTitle,
  guardianUsernameBase,
  homeChildHref,
  isGuardianRelation,
  pickChild,
  placeholderGuardianName,
  relationLabel,
} from "@/modules/iam/guardian-policy";
import { SYSTEM_ROLES } from "../../scripts/catalog";

const A = { studentProfileId: "0199a000-000d-7000-8000-0000000000a1", name: "لیلا" };
const B = { studentProfileId: "0199a000-000d-7000-8000-0000000000a2", name: "سارا" };

describe("relations", () => {
  it("are exactly the CHECK of guardian_link (migration 0020), each with a Persian label", () => {
    expect(GUARDIAN_RELATIONS).toEqual(["father", "mother", "guardian", "other"]);
    expect(Object.keys(RELATION_LABELS).sort()).toEqual([...GUARDIAN_RELATIONS].sort());
    expect(RELATION_LABELS).toEqual({ father: "پدر", mother: "مادر", guardian: "سرپرست", other: "سایر" });
    for (const r of GUARDIAN_RELATIONS) expect(isGuardianRelation(r)).toBe(true);
    for (const bad of ["", "Father", "parent", "uncle", "guardian_full"]) expect(isGuardianRelation(bad)).toBe(false);
    expect(relationLabel("mother")).toBe("مادر");
    expect(relationLabel("bogus")).toBe("سایر");
    expect(BULK_RELATION).toBe("guardian");
  });
});

describe("pickChild — `?child=` is a choice among the server's own list, never trusted", () => {
  it("no request → the first child; a request among them → that child", () => {
    expect(pickChild([A, B], undefined)).toBe(A);
    expect(pickChild([A, B], null)).toBe(A);
    expect(pickChild([A, B], "")).toBe(A);
    expect(pickChild([A, B], B.studentProfileId)).toBe(B);
  });
  it("another student's id (or garbage) → null (the page answers NOT_FOUND), never a fallback to another child", () => {
    expect(pickChild([A, B], "0199a000-000d-7000-8000-0000000000ff")).toBeNull();
    expect(pickChild([A], B.studentProfileId)).toBeNull();
    expect(pickChild([A], "not-a-uuid")).toBeNull();
  });
  it("no children → null whatever is asked", () => {
    expect(pickChild([], undefined)).toBeNull();
    expect(pickChild([], A.studentProfileId)).toBeNull();
  });
  it("childParam keeps one well-formed UUID only (arrays, junk and SQL-looking input are dropped)", () => {
    expect(childParam(A.studentProfileId)).toBe(A.studentProfileId);
    expect(childParam(A.studentProfileId.toUpperCase())).toBe(A.studentProfileId);
    expect(childParam(undefined)).toBeUndefined();
    expect(childParam([A.studentProfileId, B.studentProfileId])).toBeUndefined();
    expect(childParam("1' or '1'='1")).toBeUndefined();
    expect(childParam(`${A.studentProfileId} `)).toBeUndefined();
  });
});

describe("account identifiers", () => {
  it("a guardian whose phone is someone else's login gets `<school code>-v-<student number>`, lower-cased, starting with a letter", () => {
    expect(guardianUsernameBase("ALK", "14051001")).toBe("alk-v-14051001");
    expect(guardianUsernameBase("Dbs", "A-7")).toBe("dbs-v-a-7");
    expect(guardianUsernameBase("ALK", "14051001")).toMatch(/^[a-z][a-z0-9_-]{1,40}$/);
  });
});

describe("the bulk placeholder name", () => {
  it("names the guardian after the child: «ولیِ لیلا» «نیک‌خواه»", () => {
    expect(placeholderGuardianName({ firstName: "لیلا", lastName: "نیک‌خواه" })).toEqual({ firstName: "ولیِ لیلا", lastName: "نیک‌خواه" });
  });
});

describe("the demo dock's «ولی» labels", () => {
  it("one child: «ولیِ <name> — <class>»; several: «ولیِ ۲ فرزند: …»", () => {
    expect(guardianDemoLabel([{ name: "لیلا نیک‌خواه", className: "اول الف" }])).toBe("ولیِ لیلا نیک‌خواه — اول الف");
    expect(guardianDemoLabel([{ name: "لیلا نیک‌خواه", className: null }])).toBe("ولیِ لیلا نیک‌خواه");
    expect(guardianDemoLabel([
      { name: "لیلا نیک‌خواه", className: "اول الف" },
      { name: "سارا نیک‌خواه", className: "سوم الف" },
    ])).toBe("ولیِ ۲ فرزند: لیلا نیک‌خواه، سارا نیک‌خواه");
  });
});

describe("the guardian's bell: the kind of event and the child's name — nothing else", () => {
  it("absence, the monthly report card and the school's answer to a message (never the answer itself)", () => {
    expect(guardianNotificationTitle("absent", "لیلا نیک‌خواه")).toBe("غیبت: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("report_card", "لیلا نیک‌خواه", "مهر")).toBe("کارنامهٴ ماه مهر: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("report_card", "لیلا نیک‌خواه")).toBe("کارنامهٴ ماهانه: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("message_answered", "لیلا نیک‌خواه")).toBe("پاسخ مدرسه به پیام شما دربارهٴ لیلا نیک‌خواه");
  });
  it("deep links name the child (and the month)", () => {
    expect(childHref("attendance", A.studentProfileId)).toBe(`/child/attendance?child=${A.studentProfileId}`);
    expect(childHref("report-card", A.studentProfileId, { month: 7 })).toBe(`/child/report-card?child=${A.studentProfileId}&month=7`);
    expect(childHref("messages", A.studentProfileId)).toBe(`/child/messages?child=${A.studentProfileId}`);
    expect(homeChildHref(B.studentProfileId)).toBe(`/home?child=${B.studentProfileId}`);
  });
});

describe("the «ولی» role in the catalog", () => {
  const guardian = SYSTEM_ROLES.find((r) => r.code === "guardian_full")!;
  it("is read-only but for its own «پیام به مدرسه»: the child's work items, attendance, report card and week, its bell — no other write, no comment", () => {
    expect([...guardian.permissions].sort()).toEqual([
      "academic.attendance.read",
      "academic.objective_rating.read",
      "academic.timetable.read",
      "iam.guardian_message.send",
      "notif.notification.read",
      "workspace.work_item.read",
    ]);
    // The ONE write (owner, 2026-10-19) — a message to the school about the child; it changes nothing of the child's.
    for (const p of guardian.permissions.filter((x) => x !== "iam.guardian_message.send")) expect(p, p).toMatch(/\.read$/);
  });
  it("its message permission is nobody else's: no manager, teacher, student or counselor role holds it", () => {
    for (const r of SYSTEM_ROLES.filter((x) => x.code !== "guardian_full")) expect(r.permissions, r.code).not.toContain("iam.guardian_message.send");
  });
  it("lives at a student (or family) scope only — never a scope that reaches a class, a school or the organization", () => {
    expect(guardian.allowedScopeTypes).toEqual(["student", "family"]);
    expect(guardian.name).toBe("ولی");
  });
});
