// «ورود آزمایشی» — the panel's three dropdowns («مدرسه» → «نقش» → «حساب»), built from per-organization facts by a
// pure function (unit-tested). What reaches the browser is display labels and user_account ids — no phone, no
// username, no password, nothing of an organization outside DEMO_LOGIN_ORGS (the reads run in `demoOrgTx`).
//
// Labels let the owner pick a view by grade and class:
//   staff    «نام نام‌خانوادگی»
//   teacher  «امین ظفری — ریاضی ۱۰/۱، ۱۰/۲، ۱۰/۳… · فیزیک ۱۱/۱» — درس first, its classes after (three at most, then «…»);
//            a دبستان's class teacher (every درس of ONE class) reads «هانیه فتحی — آموزگار اول الف»
//   student  «پایهٴ اول — اول الف — لیلا نیک‌خواه», in one <optgroup> per پایه («پایهٴ اول»)
// The teacher role is «دبیر», or «آموزگار» in a دبستان (a school whose classes are all پایهٴ اول–ششم).
import { ROLE_LABELS } from "@/components/brand/roles";

export type DemoRoleKey = "org_admin" | "principal" | "vice" | "counselor" | "teacher" | "student";
export type DemoManagerHatKey = Extract<DemoRoleKey, "org_admin" | "principal" | "vice" | "counselor">;

/** The order of the «نقش» dropdown — the product's own hat order (`ROLE_ORDER`). */
export const DEMO_ROLE_ORDER: readonly DemoRoleKey[] = ["org_admin", "principal", "vice", "counselor", "teacher", "student"];

export interface DemoOption {
  /** iam.user_account.id — the ONLY value the demo login accepts. */
  id: string;
  label: string;
}
export interface DemoOptionGroup {
  /** `<optgroup label>`; null = plain options. */
  label: string | null;
  options: DemoOption[];
}
export interface DemoRole {
  key: DemoRoleKey;
  label: string;
  groups: DemoOptionGroup[];
}
export interface DemoSchool {
  /** `<organization id>/<school id>` — a client-side key only; the server never reads it. */
  key: string;
  label: string;
  roles: DemoRole[];
}
export interface DemoDirectory {
  schools: DemoSchool[];
}

// ---- inputs (one per allow-listed organization; ./repo reads them inside `demoOrgTx`) ----
export interface DemoPerson {
  personId: string;
  accountId: string;
  firstName: string;
  lastName: string;
}
export interface DemoManagerHat {
  personId: string;
  hat: DemoManagerHatKey;
  /** null = an organization-wide assignment: listed under every school of the organization. */
  schoolId: string | null;
}
export interface DemoTeaching {
  personId: string;
  schoolId: string;
  subjectName: string;
  className: string;
  gradeSeq: number;
}
export interface DemoStudentPlace {
  personId: string;
  schoolId: string;
  className: string;
  gradeName: string;
  gradeSeq: number;
}
export interface DemoSchoolFacts {
  id: string;
  name: string;
  /** A دبستان: every class of it is in پایهٴ اول–ششم. */
  primary: boolean;
}
export interface DemoOrgFacts {
  orgId: string;
  orgName: string;
  schools: DemoSchoolFacts[];
  /** The eligible accounts only (active, unlocked, no forced change, live membership and person) — the filter. */
  people: DemoPerson[];
  managers: DemoManagerHat[];
  teaching: DemoTeaching[];
  students: DemoStudentPlace[];
}

const collator = new Intl.Collator("fa", { numeric: true, sensitivity: "base" });
const byText = (a: string, b: string) => collator.compare(a, b);

const MAX_SUBJECTS = 2;
const MAX_CLASSES = 3;

export function demoRoleLabel(key: DemoRoleKey, primary: boolean): string {
  if (key === "teacher" && primary) return "آموزگار";
  return ROLE_LABELS[key];
}

export function personName(p: Pick<DemoPerson, "firstName" | "lastName">): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function gradeGroupLabel(gradeName: string): string {
  return `پایهٴ ${gradeName}`;
}

export function studentLabel(gradeName: string, className: string, name: string): string {
  return `${gradeGroupLabel(gradeName)} — ${className} — ${name}`;
}

/**
 * What a teacher teaches, for the «حساب» dropdown: «آموزگار اول الف» for a دبستان's class teacher, otherwise the
 * درس‌ها with their classes — the درس with most classes first, at most two درس‌ها and three classes each.
 */
export function teacherSummary(rows: readonly Pick<DemoTeaching, "subjectName" | "className" | "gradeSeq">[], primary: boolean): string {
  const classOrder = (a: { className: string; gradeSeq: number }, b: { className: string; gradeSeq: number }) =>
    a.gradeSeq - b.gradeSeq || byText(a.className, b.className);
  const sorted = [...rows].sort(classOrder);
  const classes = [...new Set(sorted.map((r) => r.className))];
  const bySubject = new Map<string, string[]>();
  for (const r of sorted) {
    const list = bySubject.get(r.subjectName) ?? [];
    if (!list.includes(r.className)) list.push(r.className);
    bySubject.set(r.subjectName, list);
  }
  if (primary && classes.length === 1 && bySubject.size >= 2) return `آموزگار ${classes[0]}`;
  const subjects = [...bySubject.entries()].sort((a, b) => b[1].length - a[1].length || byText(a[0], b[0]));
  const parts = subjects
    .slice(0, MAX_SUBJECTS)
    .map(([subject, list]) => `${subject} ${list.slice(0, MAX_CLASSES).join("، ")}${list.length > MAX_CLASSES ? "…" : ""}`);
  return parts.join(" · ") + (subjects.length > MAX_SUBJECTS ? " · …" : "");
}

function staffOptions(org: DemoOrgFacts, people: Map<string, DemoPerson>, hat: DemoManagerHatKey, schoolId: string): DemoOptionGroup[] {
  const seen = new Set<string>();
  const persons: DemoPerson[] = [];
  for (const m of org.managers) {
    if (m.hat !== hat || (m.schoolId !== null && m.schoolId !== schoolId) || seen.has(m.personId)) continue;
    const p = people.get(m.personId);
    if (!p) continue;
    seen.add(m.personId);
    persons.push(p);
  }
  persons.sort((a, b) => byText(a.lastName, b.lastName) || byText(a.firstName, b.firstName));
  return [{ label: null, options: persons.map((p) => ({ id: p.accountId, label: personName(p) })) }];
}

function teacherOptions(org: DemoOrgFacts, people: Map<string, DemoPerson>, school: DemoSchoolFacts): DemoOptionGroup[] {
  const rowsByPerson = new Map<string, DemoTeaching[]>();
  for (const t of org.teaching) {
    if (t.schoolId !== school.id || !people.has(t.personId)) continue;
    rowsByPerson.set(t.personId, [...(rowsByPerson.get(t.personId) ?? []), t]);
  }
  const options = [...rowsByPerson.entries()]
    .map(([personId, rows]) => {
      const p = people.get(personId)!;
      return { person: p, option: { id: p.accountId, label: `${personName(p)} — ${teacherSummary(rows, school.primary)}` } };
    })
    .sort((a, b) => byText(a.person.lastName, b.person.lastName) || byText(a.person.firstName, b.person.firstName))
    .map((x) => x.option);
  return [{ label: null, options }];
}

function studentOptions(org: DemoOrgFacts, people: Map<string, DemoPerson>, schoolId: string): DemoOptionGroup[] {
  const grades = new Map<string, { seq: number; rows: Array<{ place: DemoStudentPlace; person: DemoPerson }> }>();
  const seen = new Set<string>();
  for (const s of org.students) {
    const p = people.get(s.personId);
    if (s.schoolId !== schoolId || !p || seen.has(s.personId)) continue;
    seen.add(s.personId);
    const g = grades.get(s.gradeName) ?? { seq: s.gradeSeq, rows: [] };
    g.rows.push({ place: s, person: p });
    grades.set(s.gradeName, g);
  }
  return [...grades.entries()]
    .sort((a, b) => a[1].seq - b[1].seq || byText(a[0], b[0]))
    .map(([gradeName, g]) => ({
      label: gradeGroupLabel(gradeName),
      options: g.rows
        .sort(
          (a, b) =>
            byText(a.place.className, b.place.className) || byText(a.person.lastName, b.person.lastName) || byText(a.person.firstName, b.person.firstName),
        )
        .map(({ place, person }) => ({ id: person.accountId, label: studentLabel(gradeName, place.className, personName(person)) })),
    }));
}

export function buildDemoDirectory(orgs: readonly DemoOrgFacts[]): DemoDirectory {
  const schools: Array<DemoSchool & { orgName: string }> = [];
  for (const org of orgs) {
    const people = new Map(org.people.map((p) => [p.personId, p]));
    // An organization without a school yet still has its «مدیر سازمان».
    const places: DemoSchoolFacts[] = org.schools.length > 0 ? org.schools : [{ id: "", name: org.orgName, primary: false }];
    for (const school of places) {
      const roles: DemoRole[] = [];
      for (const key of DEMO_ROLE_ORDER) {
        const groups =
          key === "teacher" ? teacherOptions(org, people, school) : key === "student" ? studentOptions(org, people, school.id) : staffOptions(org, people, key, school.id);
        if (groups.some((g) => g.options.length > 0)) roles.push({ key, label: demoRoleLabel(key, school.primary), groups: groups.filter((g) => g.options.length > 0) });
      }
      if (roles.length > 0) schools.push({ key: `${org.orgId}/${school.id}`, label: school.name, roles, orgName: org.orgName });
    }
  }
  // Two schools of the same name (in two organizations) get their organization's name too.
  const counts = new Map<string, number>();
  for (const s of schools) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  return {
    schools: schools.map(({ orgName, ...s }) => ((counts.get(s.label) ?? 0) > 1 ? { ...s, label: `${s.label} — ${orgName}` } : s)),
  };
}
