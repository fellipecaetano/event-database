import { describe, expect, it } from "vitest";

import { createUuidV7Generator } from "./uuid-v7.js";

describe("createUuidV7Generator", () => {
  it("mints monotonic RFC 9562 UUIDv7 values when the clock does not advance", () => {
    const times = [1_754_000_000_001, 1_754_000_000_000];
    const generate = createUuidV7Generator({
      now: () => times.shift() ?? 1_754_000_000_000,
      randomBytes: (length) => new Uint8Array(length),
    });

    const identifiers = [generate(), generate()];

    expect(identifiers).toEqual([...identifiers].sort());
    expect(identifiers).toSatisfy((values: string[]) =>
      values.every((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          value,
        ),
      ),
    );
  });

  it("advances the logical millisecond after exhausting the counter", () => {
    let randomCall = 0;
    const generate = createUuidV7Generator({
      now: () => 1_754_000_000_000,
      randomBytes: (length) => {
        randomCall += 1;
        return randomCall === 1
          ? Uint8Array.from([0xff, 0xf0])
          : new Uint8Array(length);
      },
    });

    const identifiers = [generate(), generate()];

    expect(identifiers).toEqual([...identifiers].sort());
  });

  it("rejects random UUID bytes with an invalid byte count", () => {
    const generate = createUuidV7Generator({
      now: () => 1_754_000_000_000,
      randomBytes: (length) =>
        length === 2 ? new Uint8Array(length) : new Uint8Array(length - 1),
    });

    expect(generate).toThrow("randomBytes returned an invalid byte count");
  });
});
