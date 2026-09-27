import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { CourseCover } from "@/components/illustrations/CourseCover";
import { PageSection } from "@/components/layout/PageSection";
import type { Ctx } from "@/lib/ctx";
import type { MyClass } from "@/modules/academic/repo";
import type { TeachingOffering } from "@/modules/iam/hats";
import { getMyClass, resolveHomeTiles } from "./home-data";

/** One course card of Home: a درس the person takes (student) or teaches (teacher). */
export interface HomeCourse {
  offeringId: string;
  subjectId: string;
  subjectName: string;
  /** `teach`: the person teaches it — the line under the name is «کلاس <name>»; `study`: they take it — the دبیر. */
  kind: "teach" | "study";
  /** The class name (`teach`) or the دبیر's name (`study`; null while none is assigned). */
  metaName: string | null;
}

/**
 * The person's course cards, in order: the offerings they teach (from the hats read — no extra query), then the
 * درس‌ها of the class they study in (the «درس‌ها و دبیران» read, `getMyClass`). One card per offering; a person
 * with neither hat (an admin who does not teach) gets none.
 */
export function homeCourses({ teachingOfferings, myClass }: { teachingOfferings: readonly TeachingOffering[]; myClass: MyClass | null }): HomeCourse[] {
  const out = new Map<string, HomeCourse>();
  for (const o of teachingOfferings) {
    out.set(o.offeringId, { offeringId: o.offeringId, subjectId: o.subjectId, subjectName: o.subjectName, kind: "teach", metaName: o.classGroupName });
  }
  for (const t of myClass?.teachers ?? []) {
    if (!out.has(t.offeringId)) out.set(t.offeringId, { offeringId: t.offeringId, subjectId: t.subjectId, subjectName: t.subjectName, kind: "study", metaName: t.teacherName });
  }
  return [...out.values()];
}

/**
 * «درس‌های من» — the hub Home's course cards (owner, 2026-09-27, after the university LMS dashboard): under the
 * tiles, one card per درس, each a whole-surface link into its subject page. The card is the LMS shape: a patterned
 * cover in the درس's own hue with its glyph (`CourseCover`), then the name and one meta line. 2 columns on phones,
 * 3 from `md:`, 4 from `lg:`. Reads are the cached Home reads (`home-data.ts`): the student's class only for a
 * student.
 */
export async function HomeCourses({ ctx }: { ctx: Ctx }) {
  const home = await resolveHomeTiles(ctx);
  const myClass = home.isStudent ? await getMyClass() : null;
  const courses = homeCourses({ teachingOfferings: home.isTeacher ? (home.hats?.teachingOfferings ?? []) : [], myClass });
  return <CourseCards courses={courses} />;
}

/** The section itself — nothing to show, no section. */
export function CourseCards({ courses }: { courses: readonly HomeCourse[] }) {
  if (courses.length === 0) return null;
  return (
    <PageSection id="my-courses" title="درس‌های من" count={courses.length}>
      <ul className="reveal-grid grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        {courses.map((c) => (
          <li key={c.offeringId} className="flex">
            <Link
              prefetch={false}
              href={`/subjects/${c.offeringId}`}
              className="surface-work surface-link pressable flex w-full flex-col overflow-hidden rounded-card"
            >
              <CourseCover subjectId={c.subjectId} name={c.subjectName} className="h-30 md:aspect-video md:h-auto" />
              <span className="flex flex-1 items-end gap-1 px-3 pt-2.5 pb-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-row font-semibold text-text">
                    <bdi>{c.subjectName}</bdi>
                  </span>
                  <span className="truncate text-meta text-text-muted">
                    {c.kind === "teach" ? (
                      <>
                        کلاس <bdi>{c.metaName}</bdi>
                      </>
                    ) : c.metaName ? (
                      <bdi>{c.metaName}</bdi>
                    ) : (
                      "دبیر هنوز مشخص نشده"
                    )}
                  </span>
                </span>
                <ChevronLeft className="mb-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
