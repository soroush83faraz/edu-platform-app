import { createCn } from "cn/config";

/**
 * The ONE class merger (`cn`, clsx + tailwind-merge semantics), taught our `@theme` tokens in src/app/globals.css.
 *
 * The `cn` package's default tables only know Tailwind's own scales, so our named roles fell into the wrong group:
 * `text-row` / `text-meta` / … were read as text COLOURS (`cn("text-row", "text-text")` silently dropped the size),
 * `shadow-1` as a shadow colour, `bg-hero` as a background colour, and `rounded-card` / `max-w-content` / `w-rail`
 * as unknown classes that never resolved against `rounded-xl` / `max-w-3xl` / `w-4`. Registering them puts each in
 * its real group. Colours need nothing: the default text/bg/border colour groups accept any name.
 *
 * Keep these lists in step with globals.css — tests/unit/cn.test.ts parses the file and fails on a missing token.
 * Importing `cn` straight from the package is blocked by ESLint outside this file.
 */
export const THEME_TOKENS = {
  /** `--text-*` font-size roles (Tailwind's own xs…3xl are known already). */
  text: ["meta", "row", "section", "title", "display", "stamp"],
  /** `--radius-*` beyond Tailwind's t-shirt sizes. */
  radius: ["card", "hero", "stamp", "stamp-lg"],
  /** `--shadow-*`. */
  shadow: ["1"],
  /** `--container-*` (`max-w-content`). */
  container: ["content"],
  /** `--spacing-*` (`w-rail`). */
  spacing: ["rail"],
  /** `--background-image-*` (`bg-hero`): an image, so it must not replace a `bg-*` colour. */
  backgroundImage: ["hero"],
} as const;

export const cn = createCn({
  extend: {
    theme: {
      text: [...THEME_TOKENS.text],
      radius: [...THEME_TOKENS.radius],
      shadow: [...THEME_TOKENS.shadow],
      container: [...THEME_TOKENS.container],
      spacing: [...THEME_TOKENS.spacing],
    },
    classGroups: { "bg-image": [{ bg: [...THEME_TOKENS.backgroundImage] }] },
  },
});
