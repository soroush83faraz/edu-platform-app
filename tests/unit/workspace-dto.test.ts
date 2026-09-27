// The «اشخاص» picker searches from 0 characters (owner, round 7): an empty query is valid input and lists the
// first people alphabetically (tests/int/workspace-service.test.ts «searchPersons»). No I/O.
import { describe, expect, it } from "vitest";
import { SearchPersonsInput } from "@/modules/workspace/dto";

describe("SearchPersonsInput", () => {
  it("accepts an empty query and a one-letter one; trims; still caps the length and refuses unknown keys", () => {
    expect(SearchPersonsInput.parse({ q: "" })).toEqual({ q: "" });
    expect(SearchPersonsInput.parse({ q: " ز " })).toEqual({ q: "ز" });
    expect(SearchPersonsInput.safeParse({ q: "ا".repeat(61) }).success).toBe(false);
    expect(SearchPersonsInput.safeParse({ q: "", limit: 5 }).success).toBe(false);
  });
});
