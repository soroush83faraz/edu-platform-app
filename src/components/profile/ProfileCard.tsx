import { AtSign, School, Smartphone, UserRound } from "lucide-react";
import { BrandRipple } from "@/components/brand/BrandRipple";
import { ROLE_LABELS, type RoleKey } from "@/components/brand/roles";
import { formatLoginIdentifierFa, formatNumberFa } from "@/lib/format";

/**
 * The top of «حساب من» (/more, opened from the hub top bar's profile icon — owner, 2026-09-27: «make it prettier»):
 * ONE blue brand card in the Home greeting's language — `bg-hero`, `rounded-hero`, white text, the «دانینو» mark in
 * faint water rings at the end side (`BrandRipple`) — with the person's avatar (the `UserRound` glyph on a white/15
 * disc, as the top-bar profile button draws it), the full name (`text-title` bold), one pill per hat (`roleHatsFor`
 * labels, highest first; a teacher of several درس reads «دبیر · ۳ درس»), the school (the organization for an
 * organization admin) and the login identifier (a phone in Persian digits, or the username, LTR in `<bdi>`).
 *
 * Contrast: every line is pure white — the gradient's light end (#0B6FD1) takes white at 5:1, white/80 would not.
 * The hat pills DARKEN the ground (`primary-900/30`), never lighten it, so their 12 px white text stays above 5:1
 * where a white/15 pill would drop to 3.9:1. Static: no link, no hover.
 */
export function ProfileCard({
  firstName,
  lastName,
  hats,
  teaching,
  place,
  loginIdentifier,
}: {
  firstName: string;
  lastName: string;
  hats: readonly RoleKey[];
  /** How many class offerings the person teaches — named beside «دبیر» when more than one. */
  teaching: number;
  /** The school, or the organization for an organization admin. */
  place: string;
  loginIdentifier: string | null;
}) {
  const phone = loginIdentifier !== null && /^\+98/.test(loginIdentifier);
  const IdGlyph = phone ? Smartphone : AtSign;
  return (
    <section aria-label="نمایهٴ من" className="relative isolate overflow-hidden rounded-hero bg-hero px-5 py-6 text-white shadow-1 lg:px-8 lg:py-8">
      <BrandRipple className="-end-12 top-6 size-52 lg:end-10 lg:top-1/2 lg:size-64 lg:-translate-y-1/2" markSize={52} markClassName="lg:size-16" />
      <div className="flex flex-col items-start gap-4 pe-24 lg:flex-row lg:items-center lg:gap-6 lg:pe-72">
        <span aria-hidden className="grid size-18 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/35 ring-inset lg:size-22">
          <UserRound className="size-9 lg:size-11" strokeWidth={1.5} />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-title font-bold text-white">
            <bdi>
              {firstName} {lastName}
            </bdi>
          </p>
          <ul aria-label="نقش‌ها" className="flex flex-wrap gap-1.5">
            {(hats.length > 0 ? hats : [null]).map((hat) => (
              <li key={hat ?? "member"} className="rounded-full bg-primary-900/30 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/20 ring-inset">
                {hat ? ROLE_LABELS[hat] : "عضو"}
                {hat === "teacher" && teaching > 1 ? ` · ${formatNumberFa(teaching)} درس` : ""}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 text-meta text-white">
            <p className="flex min-w-0 items-center gap-2">
              <School className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <bdi className="truncate">{place}</bdi>
            </p>
            {loginIdentifier ? (
              <p className="flex min-w-0 items-center gap-2">
                <IdGlyph className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">نام‌کاربری:</span>
                <bdi dir="ltr" className="tabular truncate">
                  {formatLoginIdentifierFa(loginIdentifier)}
                </bdi>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
