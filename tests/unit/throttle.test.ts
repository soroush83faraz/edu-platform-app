import { describe, expect, it } from "vitest";
import { THROTTLE, throttleDecision, type FailureCounts } from "@/modules/iam/throttle";

const zero: FailureCounts = { identifier15m: 0, identifier1h: 0, identifier24h: 0, identifierIp15m: 0, ip10m: 0 };

describe("throttleDecision", () => {
  it("fresh identifier/ip → allowed, no escalation", () => {
    expect(throttleDecision(zero)).toEqual({ blocked: false, lockForHour: false, lockPermanently: false });
  });
  it("4 failures in 15 min are still allowed; the 5th blocks (soft lock)", () => {
    expect(throttleDecision({ ...zero, identifier15m: 4, identifier1h: 4, identifier24h: 4 }).blocked).toBe(false);
    expect(throttleDecision({ ...zero, identifier15m: 5, identifier1h: 5, identifier24h: 5 }).blocked).toBe(true);
  });
  it("the 10th failure within an hour requests the 1h account lock, the 20th the permanent lock", () => {
    expect(throttleDecision({ ...zero, identifier1h: THROTTLE.identifier1h - 1, identifier24h: THROTTLE.identifier1h - 1 })).toMatchObject({
      lockForHour: true,
      lockPermanently: false,
    });
    expect(throttleDecision({ ...zero, identifier24h: THROTTLE.identifier24h - 1 })).toMatchObject({ blocked: false, lockPermanently: true });
  });
  it("per (identifier, ip) and per ip ceilings block independently of the identifier windows", () => {
    expect(throttleDecision({ ...zero, identifierIp15m: 5 }).blocked).toBe(true);
    expect(throttleDecision({ ...zero, ip10m: 59 }).blocked).toBe(false);
    expect(throttleDecision({ ...zero, ip10m: 60 }).blocked).toBe(true);
  });
});
