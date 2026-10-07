import type { ReactNode } from "react";
import type { SubjectArt } from "@/lib/subject-icon";

/**
 * The per-درس drawings of the subject hero (`SubjectHeroArt`), in the «clay» style of the approved mock
 * (docs/mockups/class-page-v3.html `ill-math`): 2–3 chunky objects with soft gradients on a 160×130 board, mostly
 * persian-blue / sky, ONE warm (warning-yellow) accent, white highlights, a sparkle or two. The board's blob and ground
 * shadow are drawn by the frame. Colours are theme tokens (`var(--color-…)`); the shared gradients are the frame's
 * `<defs>`, reached through `u(key)`; an art's own extra ids hang off `pre`, so two arts on one page never clash.
 */
export type GradientKey = "b" | "d" | "s" | "y" | "i" | "hl";
type U = (k: GradientKey) => string;

export const C = {
  p100: "var(--color-primary-100)",
  p200: "var(--color-primary-200)",
  p300: "var(--color-primary-300)",
  p400: "var(--color-primary-400)",
  p600: "var(--color-primary-600)",
  p700: "var(--color-primary-700)",
  p900: "var(--color-primary-900)",
  sky: "var(--color-sky)",
  skyStrong: "var(--color-sky-strong)",
  info: "var(--color-info)",
  infoSoft: "var(--color-info-soft)",
  warn: "var(--color-warning)",
  warnSoft: "var(--color-warning-soft)",
  warnText: "var(--color-warning-text)",
  white: "var(--color-surface)",
  canvas: "var(--color-canvas)",
  ink: "var(--color-text)",
} as const;

/** A four-point sparkle centred on (x, y). */
function Sparkle({ x, y, r = 6, fill = C.p200 }: { x: number; y: number; r?: number; fill?: string }) {
  const k = r * 0.36;
  return <path d={`M${x} ${y - r}l${k} ${r - k} ${r - k} ${k} -${r - k} ${k} -${k} ${r - k} -${k} -${r - k} -${r - k} -${k} ${r - k} -${k}z`} fill={fill} />;
}

const math = (u: U) => (
  <>
    <g transform="rotate(-14 118 62)">
      <path fillRule="evenodd" fill={u("y")} d="M98 98H146L104 40ZM108 90H130L110 62Z" />
      <path d="M100 96h3M106 96v-3M112 96v-4M118 96v-3M124 96v-4M130 96v-3M136 96v-4" stroke={C.warnText} strokeWidth="1.2" opacity=".45" />
    </g>
    <g transform="rotate(-8 60 70)">
      <rect x="26" y="34" width="62" height="74" rx="7" fill={u("d")} />
      <rect x="31" y="31" width="58" height="72" rx="6" fill={C.white} />
      <rect x="31" y="31" width="58" height="72" rx="6" fill={C.canvas} opacity=".6" />
      <rect x="22" y="28" width="62" height="74" rx="7" fill={u("b")} />
      <rect x="27" y="28" width="5" height="74" fill={C.white} opacity=".18" />
      <rect x="40" y="44" width="30" height="5" rx="2.5" fill={C.white} opacity=".85" />
      <rect x="40" y="53" width="20" height="4" rx="2" fill={C.white} opacity=".5" />
    </g>
    <g transform="rotate(6 86 84)">
      <rect x="64" y="50" width="46" height="62" rx="9" fill={C.skyStrong} />
      <rect x="62" y="47" width="46" height="62" rx="9" fill={u("s")} />
      <rect x="69" y="54" width="32" height="13" rx="3.5" fill={C.infoSoft} />
      <rect x="88" y="58" width="9" height="5" rx="1.5" fill={C.sky} opacity=".5" />
      <g fill={C.white}>
        {[72, 83, 94].map((y) =>
          [69, 80.75, 92.5].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="8.5" height="8" rx="2.5" fill={x === 92.5 && y === 72 ? C.warn : undefined} />),
        )}
      </g>
    </g>
    <circle cx="134" cy="22" r="4" fill={C.info} />
    <Sparkle x={22} y={27} r={7} />
  </>
);

const physics = (u: U) => (
  <>
    <path d="M128 20L108 66H123L113 106L147 54H131L141 20Z" fill={u("y")} />
    <path d="M128 20L108 66H123L113 106L147 54H131L141 20Z" fill={u("hl")} />
    {[0, 60, -60].map((a) => (
      <ellipse key={a} cx="62" cy="68" rx="44" ry="16" transform={`rotate(${a} 62 68)`} fill="none" stroke={u("s")} strokeWidth="6" />
    ))}
    <circle cx="62" cy="68" r="15" fill={u("b")} />
    <circle cx="62" cy="68" r="15" fill={u("hl")} />
    <circle cx="57" cy="63" r="4" fill={C.white} opacity=".55" />
    <circle cx="18" cy="68" r="5.5" fill={C.p600} />
    <circle cx="40" cy="30" r="5.5" fill={C.p600} />
    <circle cx="84" cy="106" r="5.5" fill={C.p600} />
    <Sparkle x={104} y={22} r={6} />
    <circle cx="150" cy="96" r="3.5" fill={C.info} />
  </>
);

const FLASK = "M62 26h16v26l26 44a8 8 0 0 1-7 12H43a8 8 0 0 1-7-12l26-44z";
const chemistry = (u: U) => (
  <>
    <g transform="rotate(14 121 70)">
      <rect x="114" y="34" width="18" height="70" rx="9" fill={C.p200} />
      <rect x="112" y="32" width="18" height="70" rx="9" fill={u("i")} />
      <path d="M112 66h18v27a9 9 0 0 1-18 0z" fill={u("y")} />
      <rect x="108" y="28" width="26" height="7" rx="3.5" fill={u("b")} />
      <rect x="116" y="42" width="4" height="18" rx="2" fill={C.white} opacity=".9" />
    </g>
    <path d={FLASK} transform="translate(3 3)" fill={C.p200} />
    <path d={FLASK} fill={u("i")} />
    <path d="M49 74C62 69 78 79 91 74L104 96a8 8 0 0 1-7 12H43a8 8 0 0 1-7-12z" fill={u("b")} />
    <path d="M49 74C62 69 78 79 91 74L104 96a8 8 0 0 1-7 12H43a8 8 0 0 1-7-12z" fill={u("hl")} />
    <rect x="58" y="21" width="24" height="8" rx="4" fill={u("d")} />
    <path d="M64 36v18L48 82" stroke={C.white} strokeWidth="4" strokeLinecap="round" fill="none" opacity=".9" />
    <circle cx="62" cy="94" r="4" fill={C.white} opacity=".7" />
    <circle cx="78" cy="86" r="3" fill={C.white} opacity=".6" />
    <circle cx="84" cy="98" r="2.2" fill={C.white} opacity=".6" />
    <circle cx="86" cy="12" r="4" fill={C.info} />
    <circle cx="96" cy="22" r="2.6" fill={C.info} />
    <Sparkle x={26} y={34} r={7} />
  </>
);

const biology = (u: U) => (
  <>
    <path d="M110 108C104 82 120 60 148 56C150 84 136 104 110 108Z" fill={u("y")} />
    <path d="M110 108C104 82 120 60 148 56C150 84 136 104 110 108Z" fill={u("hl")} />
    <path d="M112 106C122 92 132 78 144 62M124 90l-6-8M131 80l-2-9M120 98l-8-3" stroke={C.warnText} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".4" />
    <rect x="30" y="102" width="70" height="13" rx="6.5" fill={u("d")} />
    <path d="M88 102C100 84 100 58 82 42" stroke={u("b")} strokeWidth="13" strokeLinecap="round" fill="none" />
    <rect x="40" y="78" width="50" height="8" rx="4" fill={u("d")} />
    <rect x="50" y="74" width="20" height="4" rx="2" fill={C.info} />
    <g transform="rotate(-28 66 46)">
      <rect x="57" y="20" width="18" height="50" rx="6" fill={u("s")} />
      <rect x="54" y="13" width="24" height="11" rx="4" fill={u("b")} />
      <rect x="61" y="68" width="10" height="9" rx="3" fill={u("d")} />
      <rect x="61" y="26" width="4" height="36" rx="2" fill={C.white} opacity=".55" />
    </g>
    <circle cx="90" cy="62" r="6" fill={C.white} />
    <circle cx="90" cy="62" r="2.5" fill={C.p600} />
    <Sparkle x={128} y={26} r={7} />
    <circle cx="22" cy="40" r="3.5" fill={C.info} />
  </>
);

const literature = (u: U) => (
  <>
    <path d="M16 70Q44 60 72 74Q100 60 128 70V112Q100 104 72 118Q44 104 16 112Z" fill={u("b")} />
    <path d="M22 62Q48 52 72 66V108Q48 96 22 104Z" fill={C.white} />
    <path d="M72 66Q96 52 122 62V104Q96 96 72 108Z" fill={u("i")} />
    <path d="M72 66V108" stroke={C.p200} strokeWidth="2" />
    <path d="M32 72Q46 67 62 74M32 82Q46 77 62 84M32 92Q42 88 52 92M82 74Q98 67 112 72M82 84Q98 77 112 82M82 94Q94 88 104 92" stroke={C.p200} strokeWidth="3" strokeLinecap="round" fill="none" />
    <g transform="translate(118 50) rotate(34)">
      <path d="M0-48C17-32 17 2 3 28H-3C-17 2-15-32 0-48Z" fill={u("y")} />
      <path d="M0-48C17-32 17 2 3 28H-3C-17 2-15-32 0-48Z" fill={u("hl")} />
      <path d="M0-40V36" stroke={C.warnText} strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <path d="M0-20l8-8M0-6l9-8M0 8l-8-8" stroke={C.white} strokeWidth="2" strokeLinecap="round" opacity=".7" />
      <path d="M-4 28H4L0 42Z" fill={u("d")} />
    </g>
    <Sparkle x={30} y={30} r={7} />
    <circle cx="54" cy="22" r="3.5" fill={C.info} />
  </>
);

const arabic = (u: U) => (
  <>
    <g transform="rotate(8 124 88)">
      <rect x="106" y="70" width="38" height="34" rx="4" fill={u("i")} />
      <path d="M113 80h24M113 88h18M113 96h22" stroke={C.p200} strokeWidth="3" strokeLinecap="round" />
      <rect x="100" y="64" width="50" height="11" rx="5.5" fill={u("s")} />
      <rect x="100" y="99" width="50" height="11" rx="5.5" fill={u("s")} />
      <rect x="104" y="66" width="40" height="3" rx="1.5" fill={C.white} opacity=".5" />
    </g>
    <g transform="rotate(-6 70 64)">
      <rect x="44" y="26" width="60" height="84" rx="7" fill={u("d")} />
      <rect x="49" y="23" width="56" height="80" rx="6" fill={C.white} />
      <rect x="40" y="20" width="60" height="84" rx="7" fill={u("b")} />
      <rect x="40" y="20" width="60" height="84" rx="7" fill={u("hl")} />
      <path d="M52 94V54Q52 38 70 30Q88 38 88 54V94Z" fill="none" stroke={C.white} strokeWidth="2.5" strokeLinejoin="round" opacity=".55" />
      <path d="M46 26h8l-8 8zM94 26h-8l8 8zM46 98h8l-8-8zM94 98h-8l8-8z" fill={C.white} opacity=".4" />
      <g transform="translate(70 62)">
        <rect x="-11" y="-11" width="22" height="22" rx="3" fill={u("y")} />
        <rect x="-11" y="-11" width="22" height="22" rx="3" transform="rotate(45)" fill={u("y")} />
        <circle r="6" fill={C.p600} />
        <circle r="2.4" fill={C.white} />
      </g>
    </g>
    <Sparkle x={130} y={36} r={7} />
    <circle cx="22" cy="46" r="3.5" fill={C.info} />
  </>
);

const english = (u: U) => (
  <>
    <rect x="22" y="99" width="88" height="11" rx="5.5" fill={u("d")} />
    <rect x="26" y="89" width="82" height="12" rx="3" fill={C.white} />
    <path d="M30 93H104M30 97H104" stroke={C.p100} strokeWidth="1.5" />
    <rect x="18" y="80" width="88" height="11" rx="5.5" fill={u("b")} />
    <rect x="26" y="82" width="40" height="3" rx="1.5" fill={C.white} opacity=".5" />
    <path d="M44 56L36 72L58 60Z" fill={u("y")} />
    <rect x="14" y="30" width="46" height="32" rx="16" fill={u("y")} />
    <path d="M26 42H48M26 51H40" stroke={C.warnText} strokeWidth="3" strokeLinecap="round" opacity=".45" />
    <path d="M118 62L128 80L104 66Z" fill={C.sky} />
    <rect x="58" y="16" width="80" height="52" rx="22" fill={u("s")} />
    <rect x="58" y="16" width="80" height="52" rx="22" fill={u("hl")} />
    <circle cx="82" cy="42" r="5" fill={C.white} />
    <circle cx="98" cy="42" r="5" fill={C.white} />
    <circle cx="114" cy="42" r="5" fill={C.white} />
    <Sparkle x={148} y={92} r={7} />
    <circle cx="146" cy="20" r="3.5" fill={C.info} />
  </>
);

// No religious emblem (subject-icon.ts rule, owner 2026-10-07): rehl + open book, with a yellow sparkle as the warm accent.
const religion = (u: U) => (
  <>
    <Sparkle x={126} y={30} r={13} fill={u("y")} />
    <path d="M44 116L98 80" stroke={u("b")} strokeWidth="11" strokeLinecap="round" />
    <path d="M100 116L46 80" stroke={u("d")} strokeWidth="11" strokeLinecap="round" />
    <path d="M24 60Q48 50 72 66Q96 50 120 60L118 88Q96 80 72 94Q48 80 26 88Z" fill={u("b")} />
    <path d="M28 54Q50 44 72 60V86Q50 72 30 80Z" fill={C.white} />
    <path d="M72 60Q94 44 116 54L114 80Q94 72 72 86Z" fill={u("i")} />
    <path d="M72 60V86" stroke={C.p200} strokeWidth="2" />
    <path d="M38 62Q50 57 62 64M38 70Q50 65 62 72M82 64Q94 57 106 62M82 72Q94 65 106 70" stroke={C.p200} strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <circle cx="72" cy="100" r="4" fill={C.white} />
    <Sparkle x={102} y={18} r={5} />
    <Sparkle x={150} y={56} r={5} fill={C.info} />
    <Sparkle x={24} y={28} r={7} />
  </>
);

const social = (u: U) => (
  <>
    <rect x="44" y="106" width="44" height="10" rx="5" fill={u("d")} />
    <rect x="62" y="96" width="8" height="12" rx="2" fill={u("d")} />
    <circle cx="66" cy="60" r="34" fill={u("b")} />
    <path d="M44 40q8-8 18-4q6 4 2 10q-6 4-4 10q2 8-6 10q-8 0-10-8q-4-10 0-18zM74 64q8-4 14 2q4 8-2 16q-6 6-12 2q-4-6 0-20zM78 36q6-2 10 2q0 4-6 4q-4 0-4-6z" fill={C.info} opacity=".9" />
    <circle cx="66" cy="60" r="34" fill={u("hl")} />
    <path d="M66 16A44 44 0 0 1 66 104" stroke={u("s")} strokeWidth="5" strokeLinecap="round" fill="none" />
    <path d="M118 18c-13 0-22 9-22 21c0 16 22 38 22 38s22-22 22-38c0-12-9-21-22-21z" fill={u("y")} />
    <path d="M118 18c-13 0-22 9-22 21c0 16 22 38 22 38s22-22 22-38c0-12-9-21-22-21z" fill={u("hl")} />
    <circle cx="118" cy="39" r="8" fill={C.white} />
    <ellipse cx="118" cy="80" rx="9" ry="3" fill={C.ink} opacity=".1" />
    <Sparkle x={24} y={24} r={7} />
    <circle cx="146" cy="96" r="3.5" fill={C.info} />
  </>
);

const tech = (u: U) => (
  <>
    <rect x="28" y="28" width="88" height="60" rx="8" fill={u("b")} />
    <rect x="34" y="34" width="76" height="47" rx="4" fill={u("s")} />
    <rect x="34" y="34" width="76" height="47" rx="4" fill={u("hl")} />
    <rect x="42" y="43" width="30" height="5" rx="2.5" fill={C.white} opacity=".9" />
    <rect x="42" y="53" width="44" height="5" rx="2.5" fill={C.white} opacity=".55" />
    <rect x="42" y="63" width="22" height="5" rx="2.5" fill={C.white} opacity=".55" />
    <rect x="86" y="60" width="16" height="13" rx="3" fill={C.white} opacity=".85" />
    <path d="M22 88H122L134 104a4 4 0 0 1-3.5 6H13.5a4 4 0 0 1-3.5-6Z" fill={C.p200} />
    <path d="M22 88H122L131 102H13Z" fill={C.p100} />
    <rect x="28" y="88" width="88" height="4" fill={C.p200} />
    <rect x="58" y="94" width="28" height="5" rx="2.5" fill={C.p200} />
    <g transform="translate(130 36)">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="-4.5" y="-21" width="9" height="10" rx="2" transform={`rotate(${a})`} fill={C.warn} />
      ))}
      <circle r="15" fill={u("y")} />
      <circle r="6" fill={C.white} />
    </g>
    <Sparkle x={18} y={36} r={7} />
    <circle cx="144" cy="78" r="3.5" fill={C.info} />
  </>
);

const sport = (u: U) => (
  <>
    <g transform="translate(116 46)">
      <rect x="-5" y="-33" width="10" height="9" rx="2.5" fill={u("d")} />
      <rect x="15" y="-25" width="8" height="7" rx="2" transform="rotate(40)" fill={u("d")} />
      <circle r="25" fill={u("y")} />
      <circle r="18" fill={C.white} />
      <path d="M0-14v3M14 0h-3M0 14v-3M-14 0h3" stroke={C.p300} strokeWidth="2" strokeLinecap="round" />
      <path d="M0 0V-10M0 0l7 5" stroke={C.p700} strokeWidth="3" strokeLinecap="round" />
      <circle r="2.5" fill={C.p700} />
    </g>
    <circle cx="60" cy="80" r="34" fill={u("b")} />
    <path d="M30 64Q60 78 92 66M46 50Q74 70 66 113M30 96Q58 86 84 104" stroke={C.white} strokeWidth="3.5" strokeLinecap="round" fill="none" opacity=".85" />
    <circle cx="60" cy="80" r="34" fill={u("hl")} />
    <Sparkle x={24} y={30} r={7} />
    <circle cx="146" cy="96" r="3.5" fill={C.info} />
  </>
);

const PALETTE = "M70 30C102 30 126 50 124 74C122 92 106 92 98 88C90 84 82 88 84 98C86 110 74 116 60 114C34 110 18 92 20 70C22 46 42 30 70 30Z";
const art = (u: U) => (
  <>
    <path d={PALETTE} transform="translate(3 4)" fill={C.p200} />
    <path d={PALETTE} fill={u("i")} />
    <circle cx="64" cy="98" r="7" fill={C.p100} />
    <circle cx="46" cy="58" r="9" fill={u("b")} />
    <circle cx="70" cy="46" r="9" fill={u("s")} />
    <circle cx="96" cy="52" r="9" fill={u("y")} />
    <circle cx="40" cy="84" r="9" fill={C.p300} />
    <circle cx="108" cy="72" r="7" fill={u("d")} />
    <g transform="translate(124 70) rotate(32)">
      <rect x="-4.5" y="-6" width="9" height="52" rx="4.5" fill={u("b")} />
      <rect x="-5.5" y="-19" width="11" height="15" rx="2" fill={C.info} />
      <path d="M-5.5-19Q-7-33 0-44Q7-33 5.5-19Z" fill={C.skyStrong} />
      <rect x="-2" y="2" width="3" height="36" rx="1.5" fill={C.white} opacity=".35" />
    </g>
    <Sparkle x={26} y={28} r={7} />
    <circle cx="140" cy="22" r="3.5" fill={C.info} />
  </>
);

const generic = (u: U) => (
  <>
    <rect x="22" y="96" width="94" height="17" rx="5" fill={u("b")} />
    <path d="M32 96v17M106 96v17" stroke={C.white} strokeWidth="3" opacity=".45" />
    <g transform="rotate(-3 72 86)">
      <rect x="30" y="79" width="80" height="17" rx="5" fill={u("s")} />
      <path d="M40 79v17M100 79v17" stroke={C.white} strokeWidth="3" opacity=".5" />
    </g>
    <g transform="rotate(2 68 70)">
      <rect x="24" y="62" width="86" height="17" rx="5" fill={u("d")} />
      <rect x="44" y="68" width="26" height="5" rx="2.5" fill={C.white} opacity=".6" />
    </g>
    <g transform="translate(128 70) rotate(22)">
      <rect x="-7" y="-50" width="14" height="11" rx="3.5" fill={C.p300} />
      <rect x="-7" y="-42" width="14" height="5" fill={C.info} />
      <rect x="-7" y="-37" width="14" height="52" fill={u("y")} />
      <rect x="-2" y="-37" width="4" height="52" fill={C.white} opacity=".35" />
      <path d="M-7 15H7L0 31Z" fill={C.warnSoft} />
      <path d="M-2.4 25.5H2.4L0 31Z" fill={C.p900} />
    </g>
    <Sparkle x={30} y={40} r={7} />
    <circle cx="56" cy="28" r="3.5" fill={C.info} />
  </>
);

export const SUBJECT_ART_DRAWINGS: Record<SubjectArt, (u: U, pre: string) => ReactNode> = {
  math,
  physics,
  chemistry,
  biology,
  literature,
  arabic,
  english,
  religion,
  social,
  tech,
  sport,
  art,
  generic,
};
