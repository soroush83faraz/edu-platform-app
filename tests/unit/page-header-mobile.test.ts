// Owner report: on /admin/schools (org admin) the count «۲ مورد» overlapped the title «مدرسه‌ها» at 375 px because
// two header actions squeezed the title's grid column down to ~111 px — title and actions shared one row on
// phones. Fix: the title always gets its own full-width row on phones; actions that don't fit wrap onto their own
// row underneath instead of squeezing the title column. Desktop (`lg:`) is untouched.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ui-variant", () => ({ getUiVariant: async () => "classic" }));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => ({ schoolName: "دبستان نمونه", yearName: "۱۴۰۵-۱۴۰۶", termName: null, schools: [] }) }));

const { PageHeader } = await import("@/components/layout/PageHeader");

async function render(props: Partial<Parameters<typeof PageHeader>[0]> = {}) {
  return renderToStaticMarkup(await PageHeader({ title: "مدرسه‌ها", ...props }));
}

/** The root <header>'s own class list, before any descendant's — `renderToStaticMarkup` HTML-escapes the quotes
 *  inside the Tailwind arbitrary-value classes (`'` → `&#x27;`), so decode them back before matching. */
const rootClass = (html: string) => (html.match(/^<header class="([^"]*)"/)?.[1] ?? "").replaceAll("&#x27;", "'");

describe("PageHeader on phones: the title never shares a row with actions", () => {
  it("the un-prefixed (phone) grid-template-areas gives title and actions each their own full-width row", async () => {
    const cls = rootClass(await render({ count: "۲ مورد", actions: createElement("span", null, "دکمه") }));
    expect(cls).toContain("'back_back'_'title_title'_'actions_actions'_'desc_desc'");
    // Never a shared "title_actions" row (that's exactly what let a wide actions block crush the title column).
    expect(cls).not.toContain("title_actions");
  });

  it("desktop (`lg:`) keeps its own unchanged template: title still on its own full row there too", async () => {
    const cls = rootClass(await render({ count: "۲ مورد", actions: createElement("span", null, "دکمه") }));
    expect(cls).toContain("lg:[grid-template-areas:'context_actions'_'back_back'_'title_title'_'desc_desc']");
  });

  it("title and count sit in one flex box, not stacked with actions absolutely positioned over them", async () => {
    const html = await render({ count: "۲ مورد", actions: createElement("span", null, "دکمه") });
    const titleBox = html.match(/<div class="([^"]*\[grid-area:title\][^"]*)"/)?.[1] ?? "";
    expect(titleBox).not.toContain("absolute");
    const actionsBox = html.match(/<div class="([^"]*\[grid-area:actions\][^"]*)"/)?.[1] ?? "";
    expect(actionsBox).not.toContain("absolute");
    // The title box itself is not shrunk by a sibling grid column: with title/actions on separate rows the title's
    // row spans the full grid (both columns), so its own area is never squeezed by the actions column.
    expect(html).toContain("مدرسه‌ها");
    expect(html).toContain("۲ مورد");
  });
});
