import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const forbiddenImport =
  /from\s+["']@event-database\/(?:core|catalogue\/(?:review|maintenance)(?:\/[^"']*)?)["']/u;

describe("catalogue-site import boundary", () => {
  it("depends only on the catalogue root interface", async () => {
    const directory = new URL(".", import.meta.url);
    const names = (await readdir(directory)).filter(
      (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
    );
    const sources = await Promise.all(
      names.map(async (name) => readFile(new URL(name, directory), "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(forbiddenImport);
  });
});
