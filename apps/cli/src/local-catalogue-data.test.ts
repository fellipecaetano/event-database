import {
  appendFile as fsAppendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitIngest,
  documentV1Schema,
  hashBytes,
  observationSchema,
  type Document,
  type Observation,
} from "@event-database/core";

import { CatalogueDataLayout } from "./catalogue-data-layout.js";
import { LocalCatalogueData } from "./catalogue-repository.js";

const roots: string[] = [];
const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const observationId = "019fa69b-63ea-778b-8ea7-232f8cbde22a";
const eventId = "019fa69b-63ea-778c-964c-a63e474676a5";
const at = "2026-07-27T22:55:00Z";
const digest = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalogue-repository-"));
  roots.push(root);
  await Promise.all(
    ["documents", "observations", "judgements", "artefacts", "inbox"].map(
      (directory) => mkdir(join(root, "data", directory), { recursive: true }),
    ),
  );
  return root;
}

function document(
  id = documentId,
  artefact = "data/artefacts/post.txt",
): Document {
  return documentV1Schema.parse({
    type: "document",
    id,
    at,
    v: 1,
    source: "source",
    retrieved_at: at,
    text_source: "retrieved",
    artefact,
    artefact_hash: digest,
    text_hash: digest,
    text: "Show",
  });
}

function observation(documentId_: string = documentId): Observation {
  return observationSchema.parse({
    type: "observation",
    id: observationId,
    at,
    v: 1,
    document: documentId_,
    extractor: "extractor@1",
    subject: { kind: "event", id: eventId },
    claims: { title: { value: "Show", spans: ["Show"] } },
    extras: {},
  });
}

describe("LocalCatalogueData", () => {
  it("treats a missing data directory as an empty catalogue", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalogue-empty-"));
    roots.push(root);
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));

    expect(await data.readLog()).toEqual([]);
  });

  it("reads partitioned records in deterministic directory and filename order", async () => {
    const root = await repository();
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const heldDocument = document();
    const heldObservation = observation();
    await writeFile(
      join(root, "data", "documents", "2026-07.jsonl"),
      `${JSON.stringify(heldDocument)}\n`,
    );
    await writeFile(
      join(root, "data", "observations", "2026-07.jsonl"),
      `${JSON.stringify(heldObservation)}\n`,
    );

    expect(await data.readLog()).toEqual([heldDocument, heldObservation]);
  });

  it("hashes retained Artefacts and omits missing ones", async () => {
    const root = await repository();
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const held = document();
    const missing = document(
      "019fa69b-63ea-778d-964c-a63e474676a5",
      "data/artefacts/missing.txt",
    );
    await writeFile(join(root, held.artefact), "bytes");

    expect(await data.artefactHashes([held, missing])).toEqual(
      new Map([[held.artefact, hashBytes(new TextEncoder().encode("bytes"))]]),
    );
  });

  it("atomically installs a remote inbox Artefact without overwriting bytes", async () => {
    const root = await repository();
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const expectedHash = hashBytes(new TextEncoder().encode("bytes"));

    expect(
      await data.installInboxArtefact("post.txt", chunks("bytes")),
    ).toEqual({ status: "installed", hash: expectedHash });
    expect(
      await data.installInboxArtefact("post.txt", chunks("bytes")),
    ).toEqual({ status: "already-present", hash: expectedHash });
    expect(
      await data.installInboxArtefact("post.txt", chunks("different")),
    ).toEqual({ status: "conflict", hash: expectedHash });
    expect(
      await readFile(join(root, "data", "inbox", "post.txt"), "utf8"),
    ).toBe("bytes");
  });

  it("appends a logical batch to its layout-derived partition", async () => {
    const root = await repository();
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const record = {
      type: "redirect" as const,
      id: "019fa69b-63ea-778d-964c-a63e474676a5",
      at,
      v: 1 as const,
      from: `event:${eventId}`,
      to: "event:019fa69b-63ea-778e-8595-cd28e40852d1",
      reason: "merged",
    };

    await data.append([record]);

    expect(
      await readFile(join(root, "data", "judgements", "2026-07.jsonl"), "utf8"),
    ).toBe(`${JSON.stringify(record)}\n`);
  });

  it("restores every affected partition when a batch append fails", async () => {
    const root = await repository();
    const documentPath = join(root, "data", "documents", "2026-07.jsonl");
    const observationPath = join(root, "data", "observations", "2026-07.jsonl");
    await writeFile(documentPath, "document-before\n");
    await writeFile(observationPath, "observation-before\n");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root), {
      appendFile: async (path, content) => {
        await fsAppendFile(path, content, "utf8");
        if (path === observationPath) {
          throw new Error("simulated append failure");
        }
      },
    });

    await expect(data.append([document(), observation()])).rejects.toThrow(
      "simulated append failure",
    );
    expect(await readFile(documentPath, "utf8")).toBe("document-before\n");
    expect(await readFile(observationPath, "utf8")).toBe(
      "observation-before\n",
    );
  });

  it("lists only unheld inbox Artefacts in deterministic order", async () => {
    const root = await repository();
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    await writeFile(join(root, "data", "inbox", "seen.txt"), "same");
    await writeFile(join(root, "data", "inbox", "new.txt"), "new");

    const pending = await data.pendingArtefacts(
      new Set([hashBytes(new TextEncoder().encode("same"))]),
    );

    expect(pending.map((item) => item.repositoryRelativePath)).toEqual([
      "data/inbox/new.txt",
    ]);
  });

  it("moves a verified inbox Artefact and appends its records", async () => {
    const root = await repository();
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(sourcePath, "source bytes");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const sourceHash = hashBytes(new TextEncoder().encode("source bytes"));
    const heldDocument = { ...document(), artefact_hash: sourceHash };
    const commit = await data.beginIngest({
      sourcePath,
      expectedHash: sourceHash,
      document: heldDocument,
      observations: [observation()],
    });

    await commitIngest(commit);

    await expect(readFile(sourcePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(root, heldDocument.artefact), "utf8")).toBe(
      "source bytes",
    );
    expect((await data.readLog()).map((record) => record.type)).toEqual([
      "document",
      "observation",
    ]);
  });

  it("rejects changed source bytes before moving the Artefact", async () => {
    const root = await repository();
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(sourcePath, "changed bytes");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));
    const originalHash = hashBytes(new TextEncoder().encode("original bytes"));
    const commit = await data.beginIngest({
      sourcePath,
      expectedHash: originalHash,
      document: { ...document(), artefact_hash: originalHash },
      observations: [],
    });

    await expect(commitIngest(commit)).rejects.toThrow(
      "inbox Artefact changed before ingest",
    );
    expect(await readFile(sourcePath, "utf8")).toBe("changed bytes");
  });

  it("restores the inbox and both partitions after a partial ingest", async () => {
    const root = await repository();
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(sourcePath, "source bytes");
    const observationPath = join(root, "data", "observations", "2026-07.jsonl");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root), {
      appendFile: async (path, content) => {
        await fsAppendFile(path, content, "utf8");
        if (path === observationPath) {
          throw new Error("observation write failed");
        }
      },
    });
    const sourceHash = hashBytes(new TextEncoder().encode("source bytes"));
    const heldDocument = { ...document(), artefact_hash: sourceHash };
    const commit = await data.beginIngest({
      sourcePath,
      expectedHash: sourceHash,
      document: heldDocument,
      observations: [observation()],
    });

    await expect(commitIngest(commit)).rejects.toThrow(
      "observation write failed",
    );
    expect(await readFile(sourcePath, "utf8")).toBe("source bytes");
    await expect(
      readFile(join(root, heldDocument.artefact)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await data.readLog()).toEqual([]);
  });

  it("rejects an existing retained Artefact destination", async () => {
    const root = await repository();
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(sourcePath, "source bytes");
    await writeFile(join(root, "data", "artefacts", "post.txt"), "held bytes");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));

    await expect(
      data.beginIngest({
        sourcePath,
        expectedHash: hashBytes(new TextEncoder().encode("source bytes")),
        document: {
          ...document(),
          artefact_hash: hashBytes(new TextEncoder().encode("source bytes")),
        },
        observations: [],
      }),
    ).rejects.toThrow(/destination already exists/u);
  });

  it("rejects a source hash that disagrees with the Document", async () => {
    const root = await repository();
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(sourcePath, "source bytes");
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));

    await expect(
      data.beginIngest({
        sourcePath,
        expectedHash: hashBytes(new TextEncoder().encode("source bytes")),
        document: document(),
        observations: [],
      }),
    ).rejects.toThrow("inbox Artefact hash does not match Document");
  });

  it("rejects symlinked inbox Artefacts", async () => {
    const root = await repository();
    const target = join(root, "outside.txt");
    const sourcePath = join(root, "data", "inbox", "post.txt");
    await writeFile(target, "outside bytes");
    await symlink(target, sourcePath);
    const data = new LocalCatalogueData(new CatalogueDataLayout(root));

    await expect(data.inspectInboxArtefact(sourcePath)).rejects.toThrow(
      "regular file",
    );
  });
});

async function* chunks(value: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(value);
}
