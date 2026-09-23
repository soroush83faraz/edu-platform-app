import { ClipboardCheck, GraduationCap, Landmark, type LucideIcon, Presentation, School, Users } from "lucide-react";
import { cn } from "cn";
import { type RoleKey, roleHatsLabel } from "./roles";

/** Where the mark is drawn: the phone header square, the Home banner's white plate, the desktop rail's school line. */
export type RoleMarkTone = "header" | "plate" | "line";

/** One glyph per hat — the mark says WHICH kind of account you are signed in as. Nothing else uses these six. */
const ROLE_GLYPHS: Record<RoleKey, LucideIcon> = {
  org_admin: Landmark,
  principal: School,
  vice: ClipboardCheck,
  teacher: Presentation,
  student: GraduationCap,
  guardian: Users,
};

/**
 * The emblem at the top of the screen. It is NOT a new element: it is the mark that already stood for the school —
 * the app header's square on phones, the white plate in the Home banner — with its glyph swapped for the one that
 * names the viewer's hat (owner: «one mark up there, and a glance at it tells me what kind of account this is»).
 * Same place, same size, same material; the school NAME stays where it is, and the product's own «دانینو» mark in
 * the desktop rail is untouched. The palette rule holds — one blue family, the hats differ by GLYPH alone.
 *
 * `tone`: `header` is the app header's 32 px hero-gradient square on phones; `plate` is the banner's white plate
 * over the hero gradient, where a blue square would disappear. Both are EXACTLY the markup the school mark had —
 * only the glyph inside changes, so nothing new is introduced into the product's icon vocabulary (CLAUDE.md keeps
 * the clay mark to the Home tiles, «خانه», illustrations, the subject page and login). `line` is the desktop
 * rail's rendering: the same glyph at 24 px in a `surface-panel` circle, on the school line under the «دانینو»
 * wordmark — the desktop has no school SQUARE to replace, and a second blue square beside the product's own mark
 * would compete with it, so the quiet material carries the hat there and the two surfaces agree on the GLYPH.
 * `hats` comes from
 * `roleHatsFor(ctx.assignments)` — no query; the highest hat is drawn and every hat is named in the accessible
 * label and the tooltip («مدیر مدرسه · دبیر»). Renders nothing with no hat — callers keep the mark they had.
 */
export function RoleMark({ hats, tone = "header", className }: { hats: readonly RoleKey[]; tone?: RoleMarkTone; className?: string }) {
  const key = hats[0];
  if (!key) return null;
  const Glyph = ROLE_GLYPHS[key];
  const label = roleHatsLabel(hats);
  if (tone === "line") {
    return (
      <span role="img" aria-label={label} title={label} className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken ring-1 ring-inset ring-line", className)}>
        <Glyph className="size-3.5 text-primary-600" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (tone === "plate") {
    return (
      <span role="img" aria-label={label} title={label} className={cn("grid size-13 place-items-center rounded-2xl bg-surface shadow-1", className)}>
        <Glyph className="size-7 text-primary-600" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} title={label} className={cn("grid size-8 shrink-0 place-items-center rounded-xl bg-hero text-white shadow-1", className)}>
      <Glyph className="size-4" strokeWidth={2} aria-hidden />
    </span>
  );
}
