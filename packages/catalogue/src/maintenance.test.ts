import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  documentV1Schema,
  hashBytes,
  observationSchema,
  type Document,
} from "@event-database/core";

import { CatalogueDataDirectory } from "./maintenance.js";

const roots: string[] = [];
const at = "2026-07-27T22:55:00Z";
const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const digest = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalogue-directory-"));
  roots.push(root);
  await Promise.all(
    ["documents", "observations", "judgements", "artefacts", "inbox"].map(
      (directory) => mkdir(join(root, "data", directory), { recursive: true }),
    ),
  );
  return root;
}

function document(): Document {
  return documentV1Schema.parse({
    type: "document",
    id: documentId,
    at,
    v: 1,
    source: "source",
    retrieved_at: at,
    text_source: "retrieved",
    artefact: "data/artefacts/post.txt",
    artefact_hash: digest,
    text_hash: hashBytes(new TextEncoder().encode("Evento")),
    text: "Evento",
  });
}

it("is constructed from a repository root and keeps layout private", async () => {
  const root = await repository();
  const data = new CatalogueDataDirectory(root);

  expect(await data.readLog()).toEqual([]);
  expect("layout" in data).toBe(false);
});

it("fully verifies records with Artefact hashes and production Extractors", async () => {
  const root = await repository();
  const heldDocument = document();
  const unknownExtractor = observationSchema.parse({
    type: "observation",
    id: "019fa69b-63ea-778b-8ea7-232f8cbde22a",
    at,
    v: 1,
    document: heldDocument.id,
    extractor: "unknown@1",
    subject: {
      kind: "event",
      id: "019fa69b-63ea-778c-964c-a63e474676a5",
    },
    claims: { title: { value: "Evento", spans: ["Evento"] } },
    extras: {},
  });
  await writeFile(
    join(root, "data", "documents", "2026-07.jsonl"),
    `${JSON.stringify(heldDocument)}\n`,
  );
  await writeFile(
    join(root, "data", "observations", "2026-07.jsonl"),
    `${JSON.stringify(unknownExtractor)}\n`,
  );
  await writeFile(join(root, heldDocument.artefact), "different bytes");

  const result = await new CatalogueDataDirectory(root).verify();

  expect(result.records).toEqual([heldDocument, unknownExtractor]);
  expect(result.issues.map((issue) => issue.code)).toEqual([
    "artefact-hash-mismatch",
    "unknown-extractor",
  ]);
});
