import { describe, expect, it } from "vitest";
import { THROTTLE, countsForIdentifier, countsForIp, throttleDecision, type FailureCounts } from "@/modules/iam/throttle";

const zero: FailureCounts = { identifier15m: 0, identifier1h: 0, identifier24h: 0, identifierIp15m: 0, ip10m: 0 };

describe("throttleDecision", () => {
  it("fresh identifier/ip → allowed, not slowed, no escalation", () => {
    expect(throttleDecision(zero)).toEqual({ blocked: false, slow: false, lockForHour: false, lockPermanently: false });
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
  it("per (identifier, ip) ceiling blocks independently of the identifier windows", () => {
    expect(throttleDecision({ ...zero, identifierIp15m: 5 }).blocked).toBe(true);
  });
  it("per ip: a school NAT is SLOWED from 300 failures / 10 min and refused only from 1000", () => {
    expect(THROTTLE.ipSlow10m).toBe(300);
    expect(THROTTLE.ipBlock10m).toBe(1000);
    expect(throttleDecision({ ...zero, ip10m: 60 })).toMatchObject({ blocked: false, slow: false }); // the old ceiling no longer blocks
    expect(throttleDecision({ ...zero, ip10m: 299 })).toMatchObject({ blocked: false, slow: false });
    expect(throttleDecision({ ...zero, ip10m: 300 })).toMatchObject({ blocked: false, slow: true });
    expect(throttleDecision({ ...zero, ip10m: 999 })).toMatchObject({ blocked: false, slow: true });
    expect(throttleDecision({ ...zero, ip10m: 1000 })).toMatchObject({ blocked: true, slow: false });
  });
});

describe("countsForIdentifier / countsForIp (mirrors of the SQL predicates in countRecentFailures)", () => {
  const live = { clearedAt: null };
  it("identifier windows count evaluated failures: bad_password, unknown, disabled and legacy rows without an outcome", () => {
    expect(countsForIdentifier({ succeeded: false, outcome: "bad_password", ...live })).toBe(true);
    expect(countsForIdentifier({ succeeded: false, outcome: "unknown", ...live })).toBe(true);
    expect(countsForIdentifier({ succeeded: false, outcome: "disabled", ...live })).toBe(true);
    expect(countsForIdentifier({ succeeded: false, outcome: null, ...live })).toBe(true);
  });
  it("a success never counts anywhere", () => {
    expect(countsForIdentifier({ succeeded: true, outcome: "success", ...live })).toBe(false);
    expect(countsForIp({ succeeded: true, outcome: "success", ...live })).toBe(false);
  });
  it("an attempt refused without a verdict (throttled / locked account) does not count against the identifier — but does against the IP", () => {
    expect(countsForIdentifier({ succeeded: false, outcome: "locked", ...live })).toBe(false);
    expect(countsForIp({ succeeded: false, outcome: "locked", ...live })).toBe(true);
  });
  it("a failure cleared by «رفع قفل» counts nowhere", () => {
    const cleared = { succeeded: false, outcome: "bad_password" as const, clearedAt: new Date() };
    expect(countsForIdentifier(cleared)).toBe(false);
    expect(countsForIp(cleared)).toBe(false);
  });
});
