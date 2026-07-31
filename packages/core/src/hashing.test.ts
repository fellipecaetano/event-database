import { describe, expect, it } from "vitest";

import { hashBytes, hashText } from "./hashing.js";

describe("hashing", () => {
  it("hashes text as UTF-8 bytes", () => {
    const text = "Música";

    expect(hashText(text)).toBe(
      "0e0cc1a93fe567a4935c582cb5bb54c2ee942dff9e635e861f3339b636f83087",
    );
    expect(hashText(text)).toBe(hashBytes(new TextEncoder().encode(text)));
  });

  it("returns the SHA-256 digest for empty input", () => {
    expect(hashBytes(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
