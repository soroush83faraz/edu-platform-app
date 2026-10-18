import { MONOGRAM_PATH, MONOGRAM_VIEWBOX } from "@/lib/brand/mark";

/**
 * The night behind the auth door (mock docs/mockups/login-v6.html, `.sky`): the radial navy, three soft orbs —
 * persian blue at the top start, sky at the bottom end, a little violet — the faint 32 px grid fading out below the
 * top, and the monogram huge and very faint at the bottom start. `fixed` and clipped to the viewport, so nothing in
 * it can widen the page (the old glow overflowed narrow phones). Decorative; the classes live in globals.css
 * («درِ تیره»); positions are logical (`start` = right in RTL), and the desktop scene is larger and wider apart.
 */
export function AuthSky() {
  return (
    <div aria-hidden className="auth-sky pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="auth-orb auth-orb-1 -top-32 -start-28 size-[26rem] lg:-top-60 lg:-start-36 lg:size-[38rem]" />
      <div className="auth-orb auth-orb-2 bottom-4 -end-40 size-[22rem] lg:-bottom-60 lg:-end-44 lg:size-[34rem]" />
      <div className="auth-orb auth-orb-3 top-64 -start-36 size-[16rem] lg:top-48 lg:start-[24rem]" />
      <div className="auth-grid absolute inset-0" />
      <svg
        viewBox={MONOGRAM_VIEWBOX}
        className="auth-ribbon absolute -bottom-52 -start-56 size-[35rem] lg:-bottom-80 lg:-start-48 lg:size-[47.5rem]"
        focusable="false"
      >
        <path d={MONOGRAM_PATH} fill="currentColor" fillRule="evenodd" />
      </svg>
    </div>
  );
}
