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
