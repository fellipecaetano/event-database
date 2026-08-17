import { describe, expect, it } from "vitest";

import { deepFreezeCopy } from "./immutable.js";

describe("deepFreezeCopy", () => {
  it("copies and recursively freezes nested JSON values", () => {
    const source = { nested: [{ value: "before" }] };

    const frozen = deepFreezeCopy(source);
    source.nested[0] = { value: "after" };

    expect(frozen).toEqual({ nested: [{ value: "before" }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested[0])).toBe(true);
  });
});
