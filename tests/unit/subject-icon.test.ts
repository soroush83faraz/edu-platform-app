// «نشان درس» (src/lib/subject-icon + `SubjectIcon`): the glyph each real curriculum name gets (the 26 names of the
// «مُهر درس» swatch page plus the other high-school books), the normalisation and rule order behind it, that the
// درس‌ها of one class read as different marks, and the rendered mark — the stamp's shape, the subject's hue.
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
  Leaf,
  Lightbulb,
  type LucideIcon,
  Microscope,
  Mountain,
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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectIcon } from "@/components/SubjectStamp";
import { subjectIcon } from "@/lib/subject-icon";
import { subjectHue } from "@/lib/subject-stamp";

const Z = "‌";

describe("subjectIcon", () => {
  it.each<[string, LucideIcon]>([
    ["ریاضی ۱", Sigma],
    ["حسابان ۲", Sigma],
    ["هندسه", PencilRuler],
    ["آمار و احتمال", ChartColumn],
    ["ریاضیات گسسته", Network],
    ["فیزیک ۲", Atom],
    ["شیمی", FlaskConical],
    [`زیست${Z}شناسی`, Dna],
    ["علوم تجربی", Microscope],
    [`زمین${Z}شناسی`, Mountain],
    ["انسان و محیط زیست", Leaf],
    ["ادبیات فارسی", BookOpen],
    ["فارسی ۱", BookOpen],
    ["نگارش", PenLine],
    ["علوم و فنون ادبی", Feather],
    ["زبان انگلیسی ۱", Languages],
    ["عربی، زبان قرآن ۱", ScrollText],
    ["دین و زندگی", Sparkles],
    [`پیام${Z}های آسمان`, Sparkles],
    ["قرآن", BookHeart],
    ["تاریخ معاصر", Landmark],
    ["جغرافیای ایران", Globe],
    ["مطالعات اجتماعی", Users],
    ["جامعه‌شناسی", Users],
    ["فلسفه", Brain],
    ["منطق", Brain],
    [`تفکر و سواد رسانه${Z}ای`, Lightbulb],
    ["کار و فناوری", Cpu],
    ["هنر", Palette],
    ["تربیت بدنی", Dumbbell],
    ["ورزش", Dumbbell],
    ["آمادگی دفاعی", Shield],
    ["سلامت و بهداشت", HeartPulse],
    ["اقتصاد", TrendingUp],
  ])("%s", (name, icon) => {
    expect(subjectIcon(name)).toBe(icon);
  });

  it("normalises Arabic ي / ك, harakat, ZWNJ-or-space and digits", () => {
    expect(subjectIcon("رياضي")).toBe(Sigma);
    expect(subjectIcon("كار و فناوری")).toBe(Cpu);
    expect(subjectIcon("عَرَبی")).toBe(ScrollText);
    expect(subjectIcon("زیست شناسی")).toBe(Dna);
    expect(subjectIcon("زیستشناسی")).toBe(Dna);
    expect(subjectIcon("  ۱۲ فیزیک")).toBe(Atom);
    expect(subjectIcon("ریاضی (تجربی)")).toBe(Sigma);
  });

  it("matches at the start of a word only: «آمادگی» is not «آمار», «هندسه» is not «هنر», «فناوری» is not «فنون»", () => {
    expect(subjectIcon("آمادگی دفاعی")).toBe(Shield);
    expect(subjectIcon("هندسه ۳")).toBe(PencilRuler);
    expect(subjectIcon("فناوری")).toBe(Cpu);
  });

  it("falls back to the neutral bookmark", () => {
    expect(subjectIcon("")).toBe(BookMarked);
    expect(subjectIcon("کلاس تقویتی")).toBe(BookMarked);
  });

  it("gives the درس‌ها of one class different marks (the owner's complaint: one grey icon on every row)", () => {
    const grade12Math = ["حسابان ۲", "هندسه ۳", "ریاضیات گسسته", "فیزیک ۳", "شیمی ۳", "فارسی ۳", "نگارش ۳", "عربی، زبان قرآن ۳", "دین و زندگی ۳", "زبان انگلیسی ۳", "سلامت و بهداشت", "مطالعات اجتماعی"];
    expect(new Set(grade12Math.map(subjectIcon)).size).toBe(grade12Math.length);
    const grade10Humanities = ["ریاضی و آمار ۱", "اقتصاد", "علوم و فنون ادبی ۱", "فارسی ۱", "نگارش ۱", "تاریخ ۱", "جغرافیای ایران", "منطق", "جامعه‌شناسی ۱", "قرآن", "آمادگی دفاعی"];
    expect(new Set(grade10Humanities.map(subjectIcon)).size).toBe(grade10Humanities.length);
  });
});

describe("SubjectIcon", () => {
  const id = "0199a1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b";
  const html = (size: "md" | "lg", name = "فیزیک") => renderToStaticMarkup(createElement(SubjectIcon, { subjectId: id, name, size }));
  const outer = (h: string) => /^<span class="([^"]*)"/.exec(h)![1]!.split(" ");

  it.each([
    ["md", ["size-9", "rounded-stamp"], "size-5"],
    ["lg", ["size-12", "rounded-stamp-lg"], "size-6"],
  ] as const)("%s wears the stamp's shape and the subject's hue", (size, box, glyph) => {
    const h = html(size);
    const c = outer(h);
    for (const e of box) expect(c).toContain(e);
    const hue = subjectHue(id);
    expect(c).toContain(`bg-subject-${hue}-bg`);
    expect(c).toContain(`text-subject-${hue}-ink`);
    expect(c.some((x) => x.includes("["))).toBe(false);
    expect(h).toMatch(new RegExp(`<svg[^>]*class="[^"]*${glyph}`));
  });

  it("draws the درس's own glyph, decorative", () => {
    expect(html("md", "فیزیک")).toContain("lucide-atom");
    expect(html("md", "شیمی")).toContain("lucide-flask-conical");
    expect(html("md", "ادبیات فارسی")).toContain("lucide-book-open");
    expect(html("md")).toMatch(/^<span[^>]*aria-hidden="true"/);
    expect(html("md")).not.toMatch(/[؀-ۿ]/);
  });
});
