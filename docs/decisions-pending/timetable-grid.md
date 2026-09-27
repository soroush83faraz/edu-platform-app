# Phone timetable as a week grid (owner 2026-09-27) — pending for docs/decisions.md

**Ask.** The phone timetable (day strip + day list, `DayAgenda`) "can't tell what's what". The owner's reference:
a Persian calendar month view — weekday letters as column headers, a grid of rounded-square cells, today filled,
no horizontal scroll. Also: no «الان» / «امروز» legend under the timetable, and no حضور percentage for students.

**Decision.**
- Phones (< md) render `WeekGrid` (src/components/timetable/WeekGrid.tsx): 6 columns (ش ی د س چ پ, the day of the
  month under each letter from `schoolWeekOf`), one row per زنگ (number only in a 26 px start column), trimmed to
  the first/last زنگ used on any day (`weekRows`); a زنگ تفریح (≥ 15 min, `BREAK_MIN_MINUTES`) is a 4 px wider gap,
  not a row. `DayAgenda` is removed.
- Width budget at 360 px: 328 content − 12 card padding − 26 start column − 6 × 4 gaps = 266 → 44.3 px columns
  (46.8 at 375); cells 48 px tall, radius `rounded-stamp-lg` — every cell is a ≥ 44 px target, no sideways scroll.
- Cells wear the درس's «مُهر درس» hue (`subjectHueClasses(subjectId)`, exported from SubjectStamp.tsx — the palette
  stays owned there) and its `stampText` letters (`text-stamp`); a دبیر's cell reads the letters + the class
  (`text-meta`). Empty زنگ = hairline outline. The slot read now carries `subjectId` (repo `SLOT_SELECT`, additive).
- Today's column header = brand fill (`primary-600`, white). The ringing cell = `ring-2 primary-600`; today's
  finished cells dim to 60 %. The selected cell = 2 px ring in its own ink (`ring-current`) + `shadow-1`.
- The green live progress bar is KEPT in the ringing cell (3 px, `inset-x-2 bottom-1`): at 44 × 48 it still reads
  as "this lesson is running, this far" and it is the only motion on the grid.
- Details card (inside the same `surface-work`, under a hairline): day (+«امروز») · زنگ label, time range (LTR bdi),
  then the session row(s) — SubjectStamp, full name, دبیر (student) / «کلاس …» (teacher) + room, «الان»/«بعدی»
  chip, end chevron — linking to /subjects/[offeringId]. A free cell reads «زنگ … آزاد است.»; a day without any
  زنگ reads `emptyDayCopy`. Default selection (`defaultWeekCell`): today's ringing or next session, else the first
  session of the following school days (wrapping; on جمعه from شنبه).
- No prev/next arrows: the schedule is a fixed weekly template. The section heading carries the week's range
  («۴ تا ۹ مهر», `schoolWeekOf`, on جمعه the coming week).
- Desktop (md+) keeps the table; its lesson cells now wear the same stamp hues (ink text, 9 % ink ring), the
  ringing cell the brand ring + progress bar. The in-cell «الان» label and the «امروز / الان» legend are removed
  (sr-only «(الان)» stays).
- The `?day=` URL state of the old day strip is gone (nothing to pick per day any more).
- Student «حضور و غیاب من» (/attendance) shows the four counts only; the «درصد حضور / درصد غیبت» card is removed.
  The student «کلاس من» page never showed a percentage. The admin report keeps its percentages.

## Follow-up (owner 2026-09-27): جمعه column, full day names

**Ask.** "Why doesn't the weekly schedule have Friday?" (reference: a Persian calendar month view whose جمعه column
is tinted as the holiday) and "I want the weekday names full, not just the first letter".

**Decision.**
- The phone grid has seven columns شنبه … جمعه (`CALENDAR_WEEKDAYS`, `FRIDAY` in src/lib/timetable.ts). The header
  reads the FULL name (`WEEKDAY_LABELS`) in `text-cell` (11 px, 600, one line) with the day of the month under it
  (`text-meta`); today stays filled in `primary-600`.
- جمعه is the holiday: a narrower column (0.625 fr) whose header and cells wear the holiday tint
  **`bg-warning-soft/60`** (soft sand — the existing `warning-soft` at 60 %, no new token or hue) with the header
  text in `warning-text`; its cells are empty buttons («جمعه، زنگ …، تعطیل») and tapping one reads «جمعه تعطیل
  است.» in the details card (no زنگ / time on its top line). A school whose data has lessons on جمعه gets an
  ordinary day column instead (seven equal columns, normal cells).
- Width at 360 px (Vazirmatn, measured): card padding 6 → 4 px, the زنگ-number column 26 → 16 px (its «زنگ» header
  label dropped), gaps 4 → 3 px: 320 − 16 − 7 × 3 = 283 px → day columns 42.7 px, جمعه 26.7 px (45.0 / 28.1 px at
  375). Header names: «چهارشنبه» 41.1 px, «پنج‌شنبه» 37.0, «جمعه» 25.9 at 11 px — one line each (12 px would need
  44.8 px). With lessons on جمعه: 40.4 px columns («چهارشنبه» overhangs 0.7 px into the gap, no clipping).
- Lesson cells lose their 1 px side padding, so a name line keeps ~42 px (was 42.3): `cellSubjectLabel` keeps its
  seven-letter budget and no name is cut that was not cut before (widest kept lines: «هدیه‌های» 41.6, «آزمایشگاه»
  41.5, «جغرافیای» 40.1 px).
- `schoolWeekOf` returns seven dates (شنبه … جمعه) and `comingWeek` (true on جمعه, when the dates are next week's):
  then no column is today — the جمعه header is not filled with next Friday's date.
- The desktop table (md+) is unchanged (شنبه … پنج‌شنبه).

## Follow-up (owner 2026-09-27): جمعه equal width, plain empty cells

**Ask.** "In the weekly schedule I want Friday to be the same size as the other days, even if empty — not squeezed
in the corner as if it were extra. It should be there, but empty."

**Decision.**
- The phone grid's seven columns are always equal width — `grid-cols-[1rem_repeat(7,minmax(0,1fr))]` after the
  period-number column — whether or not جمعه has lessons. The 0.625 fr narrow holiday column is gone.
- جمعه's header carries no tint or `data-holiday` marker any more: it reads «جمعه» and the day of the month exactly
  like any other column, and only the today-highlight rule (brand fill) still singles a column out.
- A تعطیل جمعه's cells render as ORDINARY EMPTY cells — the same faint `ring-line/70` outline as a free period on
  any other day, no sand/warning fill. They keep `data-holiday=""` and an aria-label ending «تعطیل» (screen readers
  still hear that the day is off) and tapping one still reads «جمعه تعطیل است.» in the details card, dropping the
  زنگ/time line — only the visual tint is gone. A school with جمعه lessons is unaffected (already an ordinary day).
- Width at 360 px recomputed for the now-always-equal columns: 283 px ÷ 7 = 40.4 px each (this is the same figure
  the first follow-up already measured for a school with جمعه lessons, now the default for every school). The
  widest header name, «چهارشنبه» (41.1 px), overhangs 0.7 px into the 3 px gap with no clipping, as already noted.
  `cellSubjectLabel`'s seven-letter line budget (src/lib/subject-stamp.ts) needs no change: it was already sized
  for a ~40 px column and its widest kept lines («هدیه‌های» 41.6, «آزمایشگاه» 41.5, «جغرافیای» 40.1 px) still fit.

## «کلاس من» without its page title (owner 2026-09-27)

The student «کلاس من» page drops its visible title and the «مدرسه · کلاس …» line under it: the bottom nav already
reads «کلاس من» and the class card right under it names the class and the school. `PageHeader hideTitle` keeps the
title for screen readers (sr-only heading) and, from `lg:`, only the context bar «مدرسه · سال · نوبت · date» — it
carries the year, the term and today's date, which the page shows nowhere else.
