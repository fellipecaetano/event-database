import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  documentV1Schema,
  hashBytes,
  logRecordSchema,
} from "@event-database/core";

import {
  appendRecords,
  assertPathAbsent,
  fileSize,
  readArtefactHashes,
  readLog,
  restoreFile,
} from "./catalogue-repository.js";

const roots: string[] = [];
const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const observationId = "019fa69b-63ea-778b-8ea7-232f8cbde22a";
const eventId = "019fa69b-63ea-778c-964c-a63e474676a5";
const at = "2026-07-27T22:55:00Z";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalogue-repository-"));
  roots.push(root);
  await Promise.all(
    ["documents", "observations", "judgements", "artefacts"].map((directory) =>
      mkdir(join(root, "data", directory), { recursive: true }),
    ),
  );
  return root;
}

describe("catalogue repository", () => {
  it("reads partitioned records in deterministic directory and filename order", async () => {
    const root = await repository();
    const document = logRecordSchema.parse({
      type: "document",
      id: documentId,
      at,
      v: 1,
      source: "source",
      retrieved_at: at,
      text_source: "retrieved",
      artefact: "data/artefacts/post.txt",
      artefact_hash: "a".repeat(64),
      text_hash: "b".repeat(64),
      text: "Evento",
    });
    const observation = logRecordSchema.parse({
      type: "observation",
      id: observationId,
      at,
      v: 1,
      document: documentId,
      extractor: "extractor@1",
      subject: { kind: "event", id: eventId },
      claims: { title: { value: "Evento", spans: ["Evento"] } },
      extras: {},
    });
    await writeFile(
      join(root, "data", "documents", "2026-07.jsonl"),
      `${JSON.stringify(document)}\n`,
    );
    await writeFile(
      join(root, "data", "observations", "2026-07.jsonl"),
      `${JSON.stringify(observation)}\n`,
    );

    expect(await readLog(root)).toEqual([document, observation]);
  });

  it("hashes retained Artefacts and omits missing ones", async () => {
    const root = await repository();
    const held = documentV1Schema.parse({
      type: "document",
      id: documentId,
      at,
      v: 1,
      source: "source",
      retrieved_at: at,
      text_source: "retrieved",
      artefact: "data/artefacts/held.txt",
      artefact_hash: "a".repeat(64),
      text_hash: "b".repeat(64),
      text: "Held",
    });
    const missing = documentV1Schema.parse({
      ...held,
      id: observationId,
      artefact: "data/artefacts/missing.txt",
    });
    await writeFile(join(root, held.artefact), "bytes");

    expect(await readArtefactHashes(root, [held, missing])).toEqual(
      new Map([[held.artefact, hashBytes(new TextEncoder().encode("bytes"))]]),
    );
  });

  it("appends one JSONL batch and skips empty batches", async () => {
    const calls: { readonly path: string; readonly data: string }[] = [];
    const append = (path: string, data: string): Promise<void> => {
      calls.push({ path, data });
      return Promise.resolve();
    };
    const record = logRecordSchema.parse({
      type: "redirect",
      id: documentId,
      at,
      v: 1,
      from: `event:${eventId}`,
      to: "event:019fa69b-63ea-778d-964c-a63e474676a5",
      reason: "merged",
    });

    await appendRecords("records.jsonl", [], append);
    await appendRecords("records.jsonl", [record], append);

    expect(calls).toEqual([
      { path: "records.jsonl", data: `${JSON.stringify(record)}\n` },
    ]);
  });

  it("restores existing files and removes files created by a failed append", async () => {
    const root = await repository();
    const existing = join(root, "existing.jsonl");
    const created = join(root, "created.jsonl");
    await writeFile(existing, "beforepartial");
    await writeFile(created, "partial");
    const originalSize = new TextEncoder().encode("before").length;

    expect(await fileSize(existing)).toBe("beforepartial".length);
    expect(await fileSize(join(root, "absent.jsonl"))).toBeUndefined();
    await restoreFile(existing, originalSize);
    await restoreFile(created, undefined);

    expect(await readFile(existing, "utf8")).toBe("before");
    await expect(readFile(created, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts an absent destination and rejects an existing one", async () => {
    const root = await repository();
    const path = join(root, "destination");

    await expect(assertPathAbsent(path)).resolves.toBeUndefined();
    await writeFile(path, "held");
    await expect(assertPathAbsent(path)).rejects.toThrow(
      `Artefact destination already exists: ${path}`,
    );
  });
});
