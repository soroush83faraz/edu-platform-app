// «نشان درس» — the glyph of a درس, picked from its NAME: a lab flask for شیمی, an open book for ادبیات, an atom
// for فیزیک… so a list of subjects no longer repeats one grey school mark (owner 2026-09-27). Pure; the component
// is `SubjectIcon` in src/components/SubjectStamp.tsx, which wears the subject's hue (`subjectHue`, by id).
// شیمی is `FlaskConical`, not lucide's `Pipette`: that glyph is the UI colour-picker eyedropper and reads as a tool.
import {
  Atom,
  BookHeart,
  BookMarked,
  BookOpen,
  Brain,
  ChartColumn,
  Cpu,
  Dna,
  Dumbbell,
  Feather,
  FlaskConical,
  Globe,
  HeartPulse,
  Landmark,
  Languages,
  Laptop,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Microscope,
  Mountain,
  Music,
  Network,
  Palette,
  PencilRuler,
  PenLine,
  ScrollText,
  Shield,
  Sigma,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { normalizeName } from "@/lib/subject-stamp";

/**
 * Keyword → glyph, FIRST match wins, so the specific rule sits above the general one: «علوم و فنون ادبی» is
 * literature before «علوم» is science, «عربی، زبان قرآن» is Arabic before «قرآن» / «زبان», «محیط زیست» is a leaf
 * before «زیست» is DNA, «آمار» / «گسسته» / «هندسه» are their own marks before «ریاضی» (they sit in the same class).
 * A keyword matches at the START of a word of the name (ZWNJ counts as a word break: «زیست‌شناسی» = «زیست شناسی»).
 * No religious symbols: دین / قرآن read as a book-with-heart and sparkles.
 */
const RULES: ReadonlyArray<readonly [readonly string[], LucideIcon]> = [
  [["علوم و فنون ادبی", "فنون ادبی"], Feather],
  [["نگارش", "انشا", "املا"], PenLine],
  [["ادبیات", "ادبی", "فارسی"], BookOpen],
  [["عربی"], ScrollText],
  [["انگلیسی", "زبان"], Languages],
  [["قرآن"], BookHeart],
  [["دین", "پیام های آسمان", "معارف", "احکام", "اخلاق"], Sparkles],
  [["آمار"], ChartColumn],
  [["گسسته"], Network],
  [["هندسه"], PencilRuler],
  [["ریاضی", "حسابان", "جبر"], Sigma],
  [["فیزیک"], Atom],
  [["شیمی"], FlaskConical],
  [["محیط زیست"], Leaf],
  [["زیست"], Dna],
  [["زمین شناسی"], Mountain],
  [["سلامت", "بهداشت"], HeartPulse],
  [["مطالعات اجتماعی", "علوم اجتماعی", "جامعه", "اجتماعی"], Users],
  [["علوم", "آزمایشگاه"], Microscope],
  [["تاریخ"], Landmark],
  [["جغرافیا"], Globe],
  [["اقتصاد"], TrendingUp],
  [["فلسفه", "منطق", "روان شناسی"], Brain],
  [["تفکر", "سواد"], Lightbulb],
  [["رایانه", "کامپیوتر", "برنامه نویسی"], Laptop],
  [["فناوری", "کار و فناوری"], Cpu],
  [["موسیقی"], Music],
  [["هنر", "نقاشی", "خوشنویسی"], Palette],
  [["تربیت بدنی", "ورزش"], Dumbbell],
  [["دفاع", "آمادگی دفاعی"], Shield],
];

/** Normalised as `stampText` does, then ZWNJ / punctuation / digits → one space: the text the keywords are matched in. */
function words(s: string): string {
  return normalizeName(s)
    .replace(/[\s‌،,.:;\-–—/()0-9۰-۹]+/g, " ")
    .trim();
}

const PREPARED = RULES.map(([keys, icon]) => [keys.map(words), icon] as const);

function match(text: string): LucideIcon | null {
  const padded = ` ${text}`;
  for (const [keys, icon] of PREPARED) if (keys.some((k) => padded.includes(` ${k}`))) return icon;
  return null;
}

/**
 * The glyph of a درس by its name. The clause before a subtitle («عربی، زبان قرآن» → «عربی», «ریاضی (تجربی)» →
 * «ریاضی») decides first, then the whole name; a name no rule knows gets the neutral bookmark.
 */
export function subjectIcon(name: string): LucideIcon {
  const head = normalizeName(name).split(/[،,:;(\-–—/]/)[0] ?? "";
  return match(words(head)) ?? match(words(name)) ?? BookMarked;
}
