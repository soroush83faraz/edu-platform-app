// Experimental layout switch (owner trial, 2026-09-27). "classic" = today's shell (bottom nav / rail);
// "hub" = profile + notifications top bar, no bottom nav or rail, every destination a Home tile.
// Reversible per viewer: the «ظاهر آزمایشی» toggle writes the cookie; deleting it returns to the default.
import { cookies } from "next/headers";

export type UiVariant = "classic" | "hub";
export const UI_VARIANT_COOKIE = "donino-ui";

export async function getUiVariant(): Promise<UiVariant> {
  const value = (await cookies()).get(UI_VARIANT_COOKIE)?.value;
  return value === "hub" ? "hub" : "classic";
}
