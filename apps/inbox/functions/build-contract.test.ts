import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Lambda build contract", () => {
  it("bundles the AWS SDK in CommonJS for the Node Lambda runtime", async () => {
    const manifest = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );

    expect(manifest).toContain("--format=cjs");
    expect(manifest).toContain("create-upload-intents.cjs");
    expect(manifest).toContain("zip -jqFS");
  });
});
