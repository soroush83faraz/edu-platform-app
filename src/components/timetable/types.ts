// Serializable shapes the timetable components render (a `Session` of the academic service satisfies `SessionView`).
import type { Weekday } from "@/lib/timetable";

export interface SessionView {
  offeringId: string;
  subjectName: string;
  teacherName: string | null;
  classGroupName: string;
  room: string | null;
  weekday: number;
  periodNo: number;
  label: string;
  /** `HH:mm`. */
  startsAt: string;
  endsAt: string;
}

export interface DayView {
  weekday: Weekday;
  sessions: SessionView[];
}

/** Which line the card reads under the subject: the teacher (student view) or the class (teacher view). */
export type SessionSecondary = "teacher" | "class";
