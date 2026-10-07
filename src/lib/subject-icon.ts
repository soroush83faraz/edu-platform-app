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
 * The third column is the درس's hero illustration on the subject page (`SubjectHeroArt`): one drawing per family of
 * درس‌ها (all of ریاضی / هندسه / آمار share «کتاب، ماشین‌حساب و گونیا»), picked by the same match as the glyph.
 */
export const SUBJECT_ARTS = ["math", "physics", "chemistry", "biology", "literature", "arabic", "english", "religion", "social", "tech", "sport", "art", "generic"] as const;
export type SubjectArt = (typeof SUBJECT_ARTS)[number];

const RULES: ReadonlyArray<readonly [readonly string[], LucideIcon, SubjectArt]> = [
  [["علوم و فنون ادبی", "فنون ادبی"], Feather, "literature"],
  [["نگارش", "انشا", "املا"], PenLine, "literature"],
  [["ادبیات", "ادبی", "فارسی"], BookOpen, "literature"],
  [["عربی"], ScrollText, "arabic"],
  [["انگلیسی", "زبان"], Languages, "english"],
  [["قرآن"], BookHeart, "religion"],
  [["دین", "پیام های آسمان", "معارف", "احکام", "اخلاق"], Sparkles, "religion"],
  [["آمار"], ChartColumn, "math"],
  [["گسسته"], Network, "math"],
  [["هندسه"], PencilRuler, "math"],
  [["ریاضی", "حسابان", "جبر"], Sigma, "math"],
  [["فیزیک"], Atom, "physics"],
  [["شیمی"], FlaskConical, "chemistry"],
  [["محیط زیست"], Leaf, "biology"],
  [["زیست"], Dna, "biology"],
  [["زمین شناسی"], Mountain, "social"],
  [["سلامت", "بهداشت"], HeartPulse, "biology"],
  [["مطالعات اجتماعی", "علوم اجتماعی", "جامعه", "اجتماعی"], Users, "social"],
  [["علوم", "آزمایشگاه"], Microscope, "biology"],
  [["تاریخ"], Landmark, "social"],
  [["جغرافیا"], Globe, "social"],
  [["اقتصاد"], TrendingUp, "social"],
  [["فلسفه", "منطق", "روان شناسی"], Brain, "literature"],
  [["تفکر", "سواد"], Lightbulb, "tech"],
  [["رایانه", "کامپیوتر", "برنامه نویسی"], Laptop, "tech"],
  [["فناوری", "کار و فناوری"], Cpu, "tech"],
  [["موسیقی"], Music, "art"],
  [["هنر", "نقاشی", "خوشنویسی"], Palette, "art"],
  [["تربیت بدنی", "ورزش"], Dumbbell, "sport"],
  [["دفاع", "آمادگی دفاعی"], Shield, "generic"],
];

/** Normalised as `stampText` does, then ZWNJ / punctuation / digits → one space: the text the keywords are matched in. */
function words(s: string): string {
  return normalizeName(s)
    .replace(/[\s‌،,.:;\-–—/()0-9۰-۹]+/g, " ")
    .trim();
}

const PREPARED = RULES.map(([keys, icon, art]) => [keys.map(words), icon, art] as const);

function match(text: string): (typeof PREPARED)[number] | null {
  const padded = ` ${text}`;
  for (const rule of PREPARED) if (rule[0].some((k) => padded.includes(` ${k}`))) return rule;
  return null;
}

/** The clause before a subtitle («عربی، زبان قرآن» → «عربی», «ریاضی (تجربی)» → «ریاضی») decides first, then the whole name. */
function rule(name: string): (typeof PREPARED)[number] | null {
  const head = normalizeName(name).split(/[،,:;(\-–—/]/)[0] ?? "";
  return match(words(head)) ?? match(words(name));
}

/** The glyph of a درس by its name; a name no rule knows gets the neutral bookmark. */
export function subjectIcon(name: string): LucideIcon {
  return rule(name)?.[1] ?? BookMarked;
}

/** The hero illustration of a درس by its name (`SubjectHeroArt`); a name no rule knows gets the stacked books. */
export function subjectArt(name: string): SubjectArt {
  return rule(name)?.[2] ?? "generic";
}
