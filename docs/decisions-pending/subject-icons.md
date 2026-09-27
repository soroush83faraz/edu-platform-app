# «نشان درس» — a glyph per subject (pending for docs/decisions.md)

Owner 2026-09-27: "Instead of repeating one grey school icon for every subject, use icons that match the subject
(e.g. a pipette for chemistry, a book for literature)."

## Decision

- **`subjectIcon(name)`** (`src/lib/subject-icon.ts`) — pure keyword → lucide glyph mapping over the درس NAME,
  normalised as `stampText` does (NFC, ي→ی, ك→ک, harakat stripped) with ZWNJ / punctuation / digits as word breaks.
  A keyword matches at the START of a word; rules are ordered, first match wins (the specific above the general:
  «علوم و فنون ادبی» before «علوم», «عربی، زبان قرآن» before «قرآن» / «زبان», «محیط زیست» before «زیست»,
  «آمار» / «گسسته» / «هندسه» before «ریاضی»). The clause before a subtitle decides first, then the whole name.
  Unknown names get `BookMarked`.
- **`SubjectIcon`** (`src/components/SubjectStamp.tsx`) — the glyph (20 px; 24 px `lg`) in the stamp's shape
  (36 px `rounded-stamp`; 48 px `rounded-stamp-lg`), in the subject's ink on its hue (`subjectHue(subjectId)`, the
  same eight approved subject hues — no new colour), aria-hidden.
- **Where:** subject LISTS and headers whose title IS the درس name — «کلاس من» «درس‌ها و دبیران» (was a grey
  `School` RowMark on every row), the teacher's «درس‌های من» cards on «کلاس‌های من» and the dashboard's
  «کلاس‌های من» aside (had no mark), the subject page header (was the lg stamp), the phone timetable's details card
  (was the md stamp), the teacher's «زنگ‌های امروز» on /attendance (was a grey `UserCheck` on every row).
- **Homework rows keep `SubjectStamp`** (letters): the row's title is the item, not the درس, and the stamp is the
  only place the row names its subject; a glyph there would ask the reader to decode a picture for information the
  letters give directly. The timetable GRID cells keep the name on the hue (owner 2026-09-27).

## Glyph table

| درس (keywords) | glyph |
| --- | --- |
| علوم و فنون ادبی | Feather |
| نگارش / انشا / املا | PenLine |
| ادبیات / فارسی | BookOpen |
| عربی | ScrollText |
| زبان انگلیسی / زبان | Languages |
| قرآن | BookHeart |
| دین و زندگی / پیام‌های آسمان / معارف / احکام / اخلاق | Sparkles |
| آمار | ChartColumn |
| گسسته | Network |
| هندسه | PencilRuler |
| ریاضی / حسابان / جبر | Sigma |
| فیزیک | Atom |
| شیمی | FlaskConical |
| محیط زیست | Leaf |
| زیست‌شناسی | Dna |
| زمین‌شناسی | Mountain |
| سلامت / بهداشت | HeartPulse |
| مطالعات اجتماعی / جامعه‌شناسی / اجتماعی | Users |
| علوم (تجربی) / آزمایشگاه | Microscope |
| تاریخ | Landmark |
| جغرافیا | Globe |
| اقتصاد | TrendingUp |
| فلسفه / منطق / روان‌شناسی | Brain |
| تفکر / سواد رسانه‌ای | Lightbulb |
| رایانه / برنامه‌نویسی | Laptop |
| کار و فناوری | Cpu |
| موسیقی | Music |
| هنر / نقاشی / خوشنویسی | Palette |
| تربیت بدنی / ورزش | Dumbbell |
| آمادگی دفاعی | Shield |
| (anything else) | BookMarked |

## Open for the owner

- **شیمی = `FlaskConical`, not `Pipette`.** lucide's `Pipette` is the colour-picker eyedropper of design tools; at
  20 px it reads as "pick a colour", not chemistry. The flask is the universal chemistry sign. Swapping is one line in
  `RULES` if the owner prefers the pipette.
- No religious symbols: دین / قرآن use a sparkle and a book-with-heart.
