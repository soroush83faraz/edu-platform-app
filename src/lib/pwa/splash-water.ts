// The opening splash's water (`src/components/brand/SplashScreen.tsx`): the pen writes «دانینو» over still water,
// a drop falls as it finishes, and at the instant it lands the ink turns solid — under the water, which rings out
// from the mark, bends it, and calms. The water is ONE WebGL fragment shader over a full-bleed canvas UNDER the SVG
// mark — an analytic height field (no simulation grid), refraction of the ground and the mark, a reflected sky, a
// specular light — driven by the small vanilla script below. No library, no asset.
//
// It is progressive enhancement over the CSS splash, never a dependency. The script runs inline right after the
// splash markup, WHILE the HTML is parsed (`InlineScript`), so it has compiled its shader and drawn its first frame
// before the first paint; only then does it set `data-splash-water` on `<html>`, which shows the canvas and parks
// the CSS rings. Any «no» — reduced motion, a weak device, no WebGL, a shader that fails to compile, anything that
// throws — leaves the attribute unset and the CSS splash plays as it would have. The layer's own CSS leave stays
// the hard cap either way (`SPLASH_TOTAL_MS`); the script only paints inside it.
//
// The mark is drawn ONCE at any moment: until impact by the SVG above the water (the launch still's ghost and the
// pen, as in the CSS splash), from impact by the shader (solid, refracted) — the two cross-fade over 120 ms, and
// both dip 1 → 0.97 → 1 and push in on the same curves (`globals.css`, the water rules), so there is no double image.
//
// The timeline, on the layer's clock (ms from the first frame):
//      0          the launch still: pale mark on `canvas` (the SVG ghost), exactly the iOS launch image
//     80–800      the pen writes the outline, then the channel (SVG, above the water)
//    380–820      a drop falls from above the screen to the mark's centre, accelerating; its shadow gathers
//    820          impact (`SPLASH_WATER_IMPACT_MS`) = the ink: the solid mark takes over from the pen in the water
//                 and dips; two damped wave trains leave the centre — the wavelength grows as they travel
//                 (dispersion), each decays with time, distance and distance behind its front
//   1450–1750     the surface calms to EXACTLY flat (`SPLASH_WATER_CALM_MS`); that frame is redrawn at full
//                 resolution, sharp and undistorted, and the loop stops
//   1850–2200     the layer lifts away (CSS); after it the GL context is released
// The whole picture pushes in 1.00 → 1.03 over the splash, a camera breathing in.

import { MONOGRAM_PATH } from "@/lib/brand/mark";
import { SPLASH_TOTAL_MS } from "@/lib/pwa/splash-gate";

export type SplashWaterTheme = "light" | "dark";

/**
 * Which water ships. LIGHT: pale water on `canvas`, the mark in persian-blue — it meets the `#E8EEF9` title bar and
 * the light app with no flash. DARK (deep navy water, the mark in white/ice) is built for the owner to compare in the
 * demo; it would need the layer's ground, the SVG mark's colour and the launch images to turn too before it could ship.
 */
export const SPLASH_WATER_THEME: SplashWaterTheme = "light";
/** The drop leaves the top of the screen. */
export const SPLASH_WATER_DROP_MS = 380;
/** The drop touches the water — and the ink lands: the one moment of the splash. */
export const SPLASH_WATER_IMPACT_MS = 820;
/** The surface is flat again — amplitude exactly 0 from here on. */
export const SPLASH_WATER_CALM_MS = 1750;

interface WaterOptions {
  theme: SplashWaterTheme;
  path: string;
  calm: number;
  total: number;
}

/** Fragment shader. `q` is the position in MARK units (the mark is 1 × 1, centred on 0), y down. */
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uPx, uM, uT, uDark;
uniform sampler2D uTex;
const float DROP = __DROP__, IMPACT = __IMPACT__, CALM = __CALM__, TOTAL = __TOTAL__, C = 2.4;
float train(float r, float tau) {
  float x = C * tau - r;
  if (tau <= 0.0 || x <= 0.0) return 0.0;
  float k = 24.0 / (1.0 + 0.45 * r);
  return exp(-1.2 * tau - 0.55 * r - 2.2 * x) * smoothstep(0.0, 0.06, x) * sin(k * x);
}
float height(float r) {
  float tau = (uT - IMPACT) / 1000.0;
  return 0.027 * (train(r, tau) + 0.55 * train(r, tau - 0.13)) * (1.0 - smoothstep(CALM - 300.0, CALM, uT));
}
vec3 ground(vec2 q) {
  return mix(vec3(0.910, 0.933, 0.976), mix(vec3(0.039, 0.165, 0.561), vec3(0.024, 0.102, 0.369), smoothstep(0.0, 1.8, length(q))), uDark);
}
vec3 scene(vec2 q, float ink) {
  float a = ink > 0.0 ? texture2D(uTex, q * 0.5 + 0.5).a * ink : 0.0;
  return mix(ground(q), mix(vec3(0.027, 0.165, 0.784), vec3(0.918, 0.957, 0.996), uDark), a);
}
void main() {
  vec2 p = (vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - uRes * 0.5) / uPx;
  p /= 1.0 + 0.03 * min(uT, TOTAL) / TOTAL;
  vec2 q = p / uM;
  float r = length(q), e = 0.004;
  vec2 dir = r > 0.0001 ? q / r : vec2(0.0);
  vec2 g = dir * (height(r + e) - height(max(r - e, 0.0))) / (2.0 * e);
  vec3 n = normalize(vec3(-g, 1.0));
  float x = clamp((uT - IMPACT) / 260.0, 0.0, 1.0);
  float dip = 1.0 - 0.03 * (x < 0.38 ? smoothstep(0.0, 0.38, x) : 1.0 - smoothstep(0.38, 1.0, x));
  vec3 col = scene((q - g * 0.055) / dip, smoothstep(IMPACT, IMPACT + 120.0, uT));
  vec3 ice = vec3(0.635, 0.839, 0.976);
  vec3 L = normalize(vec3(-0.5, -0.6, 0.75));
  float dd = dot(n, L) - L.z;
  vec3 hi = mix(mix(ice, vec3(1.0), 0.5), ice, uDark);
  col += dd > 0.0 ? dd * 0.9 * (hi - col) : dd * 0.55 * (col - vec3(0.0, 0.06, 0.28) * (1.0 - uDark));
  float sk = clamp(0.5 - 3.0 * (n.x + n.y), 0.0, 1.0);
  col = mix(col, mix(mix(ice, vec3(1.0), sk), mix(vec3(0.118, 0.588, 0.988), ice, sk), uDark), clamp((1.0 - n.z) * 3.0, 0.0, 0.3));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col += max(pow(max(dot(n, H), 0.0), 140.0) - pow(H.z, 140.0), 0.0) * 0.8;
  if (uT >= DROP && uT < IMPACT) {
    float s = (uT - DROP) / (IMPACT - DROP), rd = 6.5 * (1.0 + 0.15 * s);
    vec2 sc = vec2(4.0, 6.0) * (1.0 - s), ds = p - sc;
    float sr = rd * (1.0 + 2.5 * (1.0 - s));
    col *= 1.0 - (0.10 + 0.25 * uDark) * s * s * exp(-dot(ds, ds) / (sr * sr));
    vec2 D = vec2(0.0, -(uRes.y / uPx * 0.5 + 24.0) * (1.0 - s * s));
    vec2 dp = (p - D) / rd;
    float d = length(dp);
    if (d < 1.3) {
      vec3 lens = mix(ground((p - dp * rd * 0.8) / uM), ice, 0.2);
      lens = mix(lens, mix(vec3(0.027, 0.165, 0.784), ice, uDark), 0.5 * smoothstep(0.55, 1.0, d));
      vec2 sp = dp - vec2(-0.34, -0.4);
      lens += exp(-dot(sp, sp) / 0.035) * 0.95;
      col = mix(col, lens, smoothstep(1.0, 1.0 - 1.5 / rd, d));
    }
  }
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

/**
 * The script itself, as SOURCE TEXT rather than a function we stringify: a compiled function's `toString()` depends on
 * the toolchain (esbuild's keep-names, for one, wraps inner functions in a `__name` helper that does not exist in the
 * page). Plain ES2017, self-contained; `O` (the options) and `F` (the shader) are spliced in by `splashWaterScript`.
 * Kept readable on purpose — it ships unminified, well under 8 KB with the shader.
 */
const SCRIPT = `(function (o, fragment) {
  var d = document, root = d.documentElement;
  try {
    if (root.dataset.splash !== "on") return;
    var mm = window.matchMedia;
    if (mm && mm("(prefers-reduced-motion: reduce)").matches) return;
    var nav = navigator;
    if ((nav.deviceMemory !== undefined && nav.deviceMemory < 2) || (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2)) return;
    var cv = d.querySelector("canvas.splash-water");
    if (!cv) return;
    var gl = cv.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
    if (!gl) return;

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader");
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}"));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    function u(name) { return gl.getUniformLocation(prog, name); }

    // The scene under the water: the mark as a coverage mask in the middle half of a texture spanning 2 x 2 marks,
    // so every refracted sample lands on clear ground. Drawn from the same path as every other rendering.
    var w = window.innerWidth, h = window.innerHeight;
    var m = Math.min(0.4 * Math.min(w, h), 280);
    var dpr = window.devicePixelRatio || 1;
    var side = Math.min(2048, Math.ceil(2 * m * Math.min(dpr, 2)));
    var tc = d.createElement("canvas");
    tc.width = tc.height = side;
    var c2 = tc.getContext("2d");
    c2.translate(side / 4, side / 4);
    c2.scale(side / 128, side / 128);
    c2.fill(new Path2D(o.path), "evenodd");
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1f(u("uM"), m);
    gl.uniform1f(u("uDark"), o.theme === "dark" ? 1 : 0);
    var uT = u("uT");

    // In motion: 0.75 x min(dpr, 1.5), for speed. The calm last frame: min(dpr, 2), so the mark settles sharp.
    function size(px) {
      cv.width = Math.round(w * px);
      cv.height = Math.round(h * px);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(u("uRes"), cv.width, cv.height);
      gl.uniform1f(u("uPx"), cv.width / w);
    }
    function draw(t) {
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    var t0 = performance.now();
    size(0.75 * Math.min(dpr, 1.5));
    draw(0);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("draw");
    root.dataset.splashWater = "on";

    function frame() {
      var t = performance.now() - t0;
      if (t < o.calm) {
        draw(t);
        requestAnimationFrame(frame);
        return;
      }
      size(Math.min(dpr, 2));
      draw(o.calm);
      // After the layer has left, free the GPU; the canvas is no longer painted by then.
      setTimeout(function () {
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }, Math.max(0, o.total - t) + 100);
    }
    requestAnimationFrame(frame);
  } catch (e) {
    delete root.dataset.splashWater;
  }
})(O, F)`;

/** The inline script for a given theme: the source above with its options and shader spliced in. */
export function splashWaterScript(theme: SplashWaterTheme = SPLASH_WATER_THEME): string {
  const options: WaterOptions = { theme, path: MONOGRAM_PATH, calm: SPLASH_WATER_CALM_MS, total: SPLASH_TOTAL_MS };
  const glsl = FRAGMENT.replace("__DROP__", SPLASH_WATER_DROP_MS.toFixed(1))
    .replace("__IMPACT__", SPLASH_WATER_IMPACT_MS.toFixed(1))
    .replace("__CALM__", SPLASH_WATER_CALM_MS.toFixed(1))
    .replace("__TOTAL__", SPLASH_TOTAL_MS.toFixed(1))
    .replace(/\n\s*/g, "\n");
  return SCRIPT.replace("(O, F)", () => `(${JSON.stringify(options)}, ${JSON.stringify(glsl)})`);
}

export const SPLASH_WATER_SCRIPT = splashWaterScript();
