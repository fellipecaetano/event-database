import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { logRecordSchema } from "./index.js";

const logFiles = [
  "../../../data/documents/2026-07.jsonl",
  "../../../data/observations/2026-07.jsonl",
  "../../../data/judgements/2026-07.jsonl",
];

describe("existing log compatibility", () => {
  it("accepts every record already in the append-only log", () => {
    const records = logFiles.flatMap((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const value: unknown = JSON.parse(line);
          return value;
        }),
    );

    const results = records.map((record) => logRecordSchema.safeParse(record));

    expect(results.filter((result) => !result.success)).toEqual([]);
    // The log only ever grows, so an exact count would go red after every
    // ingest or review session. This guards the case that matters: an empty
    // read making the assertion above pass vacuously.
    expect(results.length).toBeGreaterThan(0);
  });
});
