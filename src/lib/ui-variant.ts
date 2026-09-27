// The layout switch. "hub" = profile + notifications top bar, no bottom nav or rail, every destination a Home tile;
// "classic" = the earlier shell (bottom nav / rail).
//
// The owner tried the hub layout and adopted it for EVERYONE (2026-09-27, docs/decisions-pending/home-hub.md):
// `getUiVariant()` returns "hub" unconditionally. It no longer reads the old `donino-ui` cookie, so a leftover
// `donino-ui=classic` from the trial is ignored and nobody can switch (the «ظاهر آزمایشی» toggle on «بیشتر» is
// gone). The classic branches (`AppShell`, `PageHeader`, `homeTilesFor`'s `HOME_TILES`, Home's «تکالیف نزدیک»
// card and «امروز» line) are kept on purpose: returning "classic" here — this ONE function — reverts the whole
// app to the earlier layout without touching anything else.
export type UiVariant = "classic" | "hub";

export async function getUiVariant(): Promise<UiVariant> {
  return "hub";
}
