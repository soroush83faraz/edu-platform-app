// scripts/demo-extras-plan.ts — the pure half of `pnpm seed:demo-extras`: stable item keys, deadlines relative to
// the Tehran day of «now», the class share that marks a homework done, the legacy-title rename and the plan's shape.
import { describe, expect, it } from "vitest";
import {
  DEMO_ITEMS,
  LEGACY_NEW_PREFIX,
  demoDueAt,
  demoItemKey,
  externalRefOf,
  pickDoers,
  planPersons,
  renameLegacyTitle,
  tehranIsoDay,
} from "../../scripts/demo-extras-plan";

describe("demoItemKey", () => {
  it("is deterministic, UUID-shaped and distinct per organization and slug", () => {
    const k = demoItemKey("alk", "admin:staff-list");
    expect(k).toBe(demoItemKey("alk", "admin:staff-list"));
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(demoItemKey("frz", "admin:staff-list")).not.toBe(k);
    expect(demoItemKey("alk", "admin:exam-schedule")).not.toBe(k);
  });

  it("gives every planned item of an organization its own key", () => {
    for (const org of ["alk", "frz", "hl4"]) {
      const keys = DEMO_ITEMS.map((i) => demoItemKey(org, i.slug));
      expect(new Set(keys).size).toBe(DEMO_ITEMS.length);
    }
  });
});

describe("demoDueAt", () => {
  // 2026-09-28 21:10 UTC = 2026-09-29 00:40 Tehran: the Tehran day has already turned.
  const lateNight = new Date("2026-09-28T21:10:00Z");
  const noon = new Date("2026-09-28T08:30:00Z"); // 12:00 Tehran

  it("anchors on the Tehran calendar day, at the Tehran wall-clock time", () => {
    expect(demoDueAt({ days: 0, at: "23:30" }, noon)?.toISOString()).toBe("2026-09-28T20:00:00.000Z");
    expect(tehranIsoDay(demoDueAt({ days: 0, at: "23:30" }, lateNight)!)).toBe("2026-09-29");
    expect(demoDueAt({ days: -2, at: "14:00" }, noon)?.toISOString()).toBe("2026-09-26T10:30:00.000Z");
  });

  it("returns null for no deadline and rejects a malformed time", () => {
    expect(demoDueAt(null, noon)).toBeNull();
    expect(() => demoDueAt({ days: 1, at: "9:00" }, noon)).toThrow();
  });

  it("spreads the plan: overdue, today, this week, later and none; every extension lands in the future", () => {
    const today = tehranIsoDay(noon);
    const days = DEMO_ITEMS.map((i) => (i.due ? i.due.days : null));
    expect(days.some((d) => d !== null && d < 0 && d >= -3)).toBe(true);
    expect(days.some((d) => d === 0)).toBe(true);
    expect(days.some((d) => d !== null && d > 0 && d <= 6)).toBe(true);
    expect(days.some((d) => d !== null && d > 6)).toBe(true);
    expect(days.some((d) => d === null)).toBe(true);
    for (const i of DEMO_ITEMS.filter((x) => x.due?.days === 0)) expect(tehranIsoDay(demoDueAt(i.due, noon)!)).toBe(today);
    for (const i of DEMO_ITEMS.filter((x) => x.extendTo)) expect(demoDueAt(i.extendTo!, noon)!.getTime()).toBeGreaterThan(noon.getTime() + 24 * 3600 * 1000);
  });
});

describe("pickDoers", () => {
  const roster = ["c", "a", "e", "b", "d"];

  it("is a stable share of the class — at least one, never everyone", () => {
    expect(pickDoers(roster, 0.4)).toEqual(["a", "b"]);
    expect(pickDoers([...roster].reverse(), 0.4)).toEqual(["a", "b"]);
    expect(pickDoers(roster, 0.01)).toEqual(["a"]);
    expect(pickDoers(roster, 1)).toHaveLength(4);
    expect(pickDoers(["a"], 0.5)).toEqual([]);
    expect(pickDoers(roster, 0)).toEqual([]);
  });
});

describe("renameLegacyTitle", () => {
  it("rewrites only «کار جدید: …» titles to the creator's word", () => {
    expect(renameLegacyTitle(`${LEGACY_NEW_PREFIX}تمرین‌های فصل ۱`, "تکلیف جدید")).toBe("تکلیف جدید: تمرین‌های فصل ۱");
    expect(renameLegacyTitle(`${LEGACY_NEW_PREFIX}ثبت نمرات`, "تسک جدید")).toBe("تسک جدید: ثبت نمرات");
    expect(renameLegacyTitle("تکلیف جدید: تمرین", "تسک جدید")).toBeNull();
    expect(renameLegacyTitle(`${LEGACY_NEW_PREFIX}${"ا".repeat(300)}`, "تکلیف جدید")).toHaveLength(200);
  });
});

describe("the plan", () => {
  it("covers every role: admin → managers, managers → دبیران, personal notes, students, the first دبیر's classes", () => {
    const by = (actor: string) => DEMO_ITEMS.filter((i) => i.actor === actor);
    const tasksTo = (actor: string) => by(actor).filter((i) => i.typeCode === "task");
    expect(tasksTo("admin").length).toBeGreaterThanOrEqual(3);
    expect(tasksTo("admin").every((i) => i.recipients.kind === "persons" && i.recipients.who.every((w) => w === "principal" || w === "vice"))).toBe(true);
    expect(tasksTo("admin").some((i) => i.extendTo)).toBe(true);
    expect(tasksTo("admin").some((i) => i.doneBy?.length)).toBe(true);
    expect(tasksTo("principal").length).toBeGreaterThanOrEqual(3);
    expect(tasksTo("principal").every((i) => i.recipients.kind === "persons" && i.recipients.who.every((w) => w.startsWith("teacher-")))).toBe(true);
    expect(tasksTo("vice").length).toBeGreaterThanOrEqual(1);
    for (const who of ["admin", "principal", "vice"]) expect(by(who).filter((i) => i.typeCode === "todo" && i.recipients.kind === "self").length).toBeGreaterThanOrEqual(1);
    expect(DEMO_ITEMS.filter((i) => i.actor.startsWith("student-")).every((i) => i.typeCode === "todo" && i.recipients.kind === "self")).toBe(true);
    const teacher = by("teacher-1");
    expect(teacher.every((i) => i.recipients.kind === "class")).toBe(true);
    expect(teacher.some((i) => i.closeByGiver) && teacher.some((i) => i.extendTo) && teacher.some((i) => i.doneShare && !i.closeByGiver && !i.extendTo)).toBe(true);
  });

  it("only personal items are marked done by their own author, and every slug is unique", () => {
    for (const i of DEMO_ITEMS) if (i.doneBy?.includes(i.actor)) expect(i.recipients.kind).toBe("self");
    expect(new Set(DEMO_ITEMS.map((i) => i.slug)).size).toBe(DEMO_ITEMS.length);
  });

  it("maps person references to the pilot's external refs", () => {
    expect(externalRefOf("alk", "principal")).toBe("pilot:alk:principal");
    expect(externalRefOf("frz", "teacher-1")).toBe("pilot:frz:teacher-1");
    expect(externalRefOf("hl4", "student-0")).toBe("pilot:hl4:student:14051001");
    expect(planPersons()).toEqual(expect.arrayContaining(["admin", "principal", "vice", "teacher-1", "student-0"]));
  });
});
