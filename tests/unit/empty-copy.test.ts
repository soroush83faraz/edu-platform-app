// Empty states in the reader's voice (src/lib/empty-copy.ts, UX review 2026-09-27): a student is «تو», staff «شما»,
// the noun follows work-item-words (تکلیف / تسک), and every line names the next step — never «داده‌ای وجود ندارد».
import { describe, expect, it } from "vitest";
import { type Audience, audienceOf, emptyDoneCopy, emptyNotificationsCopy, emptyOpenCopy } from "@/lib/empty-copy";

const a = (roleCode: string, scopeType: string, permissions: string[] = []) => ({ roleCode, scopeType, permissions });
const student = a("student", "student", ["workspace.work_item.read"]);
const teacher = a("teacher", "class_offering", ["workspace.work_item.assign_class"]);
const principal = a("school_principal", "school", ["iam.admin.access"]);

const AUDIENCES: Audience[] = ["student", "teacher", "admin", "member"];
const all = () =>
  AUDIENCES.flatMap((au) => [emptyOpenCopy(au, true, true), emptyOpenCopy(au, true), emptyOpenCopy(au, false), emptyDoneCopy(au), emptyNotificationsCopy(au)].map((c) => ({ au, c })));

describe("audienceOf", () => {
  it("student only → student; any teaching hat → teacher (a teaching principal too); admin; anyone else → member", () => {
    expect(audienceOf([student])).toBe("student");
    expect(audienceOf([teacher])).toBe("teacher");
    expect(audienceOf([teacher, principal])).toBe("teacher");
    expect(audienceOf([student, teacher])).toBe("teacher");
    expect(audienceOf([principal])).toBe("admin");
    expect(audienceOf([a("guardian_full", "family")])).toBe("member");
  });
});

describe("empty copy", () => {
  it("a student is spoken to as «تو»: no «شما», no plural-polite verb", () => {
    for (const { au, c } of all()) {
      if (au !== "student") continue;
      const text = `${c.title} ${c.description}`;
      expect(text).not.toMatch(/شما|ید\.|ید،/);
    }
    expect(emptyOpenCopy("student", true).title).toBe("فعلاً تکلیفی نداری.");
  });

  it("staff are «شما» and an admin who does not teach reads «تسک», a دبیر «تکلیف»", () => {
    for (const { au, c } of all()) {
      if (au === "student") continue;
      expect(`${c.title} ${c.description}`).not.toMatch(/نداری(?!د)|خبرت(?!ان)|کنی(?![دم])|بزنی(?!د)/);
    }
    for (const c of [emptyOpenCopy("admin", true), emptyDoneCopy("admin")]) expect(c.title).toContain("تسک");
    expect(emptyOpenCopy("teacher", true, true).title).toBe("هنوز تکلیفی نداده‌اید.");
    // Once a دبیر has given work, «هنوز … نداده‌اید» would be untrue.
    expect(emptyOpenCopy("teacher", true, false).title).not.toContain("نداده");
  });

  it("every line has a next step and none is the generic «داده‌ای وجود ندارد»; no Latin letters", () => {
    for (const { c } of all()) {
      expect(c.description.length).toBeGreaterThan(10);
      expect(`${c.title}${c.description}`).not.toContain("داده‌ای وجود");
      expect(`${c.title}${c.description}`).not.toMatch(/[A-Za-z]/);
    }
  });
});
