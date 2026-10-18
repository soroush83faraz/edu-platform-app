// «ورود آزمایشی» — the server-side gate: the feature is ON (./config) AND this browser carries a valid unlock
// cookie (./unlock). Read on every demo request — the login page's panel, the panel's list and the demo login
// itself (`defineDemoAction`, src/lib/actions) — never cached, never taken from client input.
import { cookies } from "next/headers";
import { demoConfigFrom, type DemoConfig } from "./config";
import { DEMO_COOKIE_NAME, verifyDemoUnlock } from "./unlock";

/** From `process.env` on every call (src/lib/env.ts already refused a malformed value at boot). */
export function demoConfig(): DemoConfig {
  const e = process.env;
  return demoConfigFrom({ DEMO_LOGIN: e.DEMO_LOGIN, DEMO_LOGIN_KEY: e.DEMO_LOGIN_KEY, DEMO_LOGIN_ORGS: e.DEMO_LOGIN_ORGS, SESSION_SECRET: e.SESSION_SECRET });
}

export async function demoGateOpen(cfg: DemoConfig = demoConfig(), nowMs: number = Date.now()): Promise<boolean> {
  if (!cfg.enabled) return false;
  const store = await cookies();
  return verifyDemoUnlock(cfg, store.get(DEMO_COOKIE_NAME)?.value, nowMs);
}
