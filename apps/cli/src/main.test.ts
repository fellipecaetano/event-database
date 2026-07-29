import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./main.js";

const temporaryDirectories: string[] = [];
const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const observationId = "019fa69b-63ea-778b-8ea7-232f8cbde22a";
const digest = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function makeRepository(record: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "event-database-cli-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "data", "documents"), { recursive: true });
  await mkdir(join(root, "data", "observations"), { recursive: true });
  await mkdir(join(root, "data", "judgements"), { recursive: true });
  await writeFile(
    join(root, "data", "documents", "2026-07.jsonl"),
    `${JSON.stringify(record)}\n`,
  );
  return root;
}

describe("verify command", () => {
  it("reports a valid log and exits successfully", async () => {
    const artefactHash =
      "3b9c358f36f0a31b6ad3e14f309c7cf198ac9246e8316f9ce543d5b19ac02b80";
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.txt",
      text_hash: digest,
      artefact_hash: artefactHash,
      text: "Show",
    });
    await mkdir(join(root, "data", "artefacts"));
    await writeFile(join(root, "data", "artefacts", "post.txt"), "file");
    const output: string[] = [];

    const exitCode = await runCli(["verify", root], {
      writeOut: (message) => output.push(message),
      writeError: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual(["Verified 1 record."]);
  });

  it("reports verification failures and exits unsuccessfully", async () => {
    const root = await makeRepository({ type: "document" });
    const errors: string[] = [];

    const exitCode = await runCli(["verify", root], {
      writeOut: () => undefined,
      writeError: (message) => errors.push(message),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/data\/documents\/2026-07\.jsonl:1/u);
  });
});

describe("ingest command", () => {
  it("retains an inbox Artefact and appends validated records", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "existing",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/existing.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "Existing",
    });
    const inbox = join(root, "data", "inbox");
    await mkdir(inbox);
    const artefact = join(inbox, "post.txt");
    await writeFile(artefact, "original bytes");
    const draftPath = join(root, "draft.json");
    await writeFile(
      draftPath,
      JSON.stringify({
        document: {
          source: {
            value: "instagram/venue",
            supplied_by: "person:reviewer",
          },
          retrieved_at: "2026-07-28T10:00:00Z",
          text_source: "retrieved",
          text: "Show at Venue",
        },
        extractor: "tsv-parser@1",
        observations: [
          {
            subject: "event",
            claims: {
              title: { value: "Show", spans: ["Show"] },
              venue_name: { value: "Venue", spans: ["Venue"] },
            },
            extras: {},
          },
        ],
      }),
    );
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCli(["ingest", draftPath, artefact, root], {
      writeOut: (message) => output.push(message),
      writeError: (message) => errors.push(message),
      now: () => Date.parse("2026-07-28T12:00:00Z"),
      randomBytes: (length) => new Uint8Array(length),
    });

    expect(errors).toEqual([]);
    expect(exitCode).toBe(0);
    expect(output[0]).toMatch(
      /^Ingested Document [0-9a-f-]+ with 1 Observation\.$/u,
    );
    await expect(access(artefact)).rejects.toThrow();
    expect(
      await readFile(join(root, "data", "artefacts", "post.txt"), "utf8"),
    ).toBe("original bytes");
    expect(
      await readFile(
        join(root, "data", "observations", "2026-07.jsonl"),
        "utf8",
      ),
    ).toContain('"type":"observation"');
  });

  it("refuses an Artefact whose bytes are already recorded", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "existing",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/existing.txt",
      text_hash: digest,
      artefact_hash:
        "0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5",
      text: "Existing",
    });
    const inbox = join(root, "data", "inbox");
    await mkdir(inbox);
    const artefact = join(inbox, "post.txt");
    await writeFile(artefact, "same");
    const draftPath = join(root, "draft.json");
    await writeFile(draftPath, "{}");
    const errors: string[] = [];

    const exitCode = await runCli(["ingest", draftPath, artefact, root], {
      writeOut: () => undefined,
      writeError: (message) => errors.push(message),
      now: () => Date.parse("2026-07-28T12:00:00Z"),
      randomBytes: (length) => new Uint8Array(length),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain(`already Document ${documentId}`);
    await expect(access(artefact)).resolves.toBeUndefined();
  });

  it("does not overwrite an existing Artefact with the same filename", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "existing",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/existing.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "Existing",
    });
    const inbox = join(root, "data", "inbox");
    const artefacts = join(root, "data", "artefacts");
    await mkdir(inbox);
    await mkdir(artefacts);
    const incoming = join(inbox, "post.txt");
    const retained = join(artefacts, "post.txt");
    await writeFile(incoming, "incoming");
    await writeFile(retained, "retained");
    const draftPath = join(root, "draft.json");
    await writeFile(
      draftPath,
      JSON.stringify({
        document: {
          source: {
            value: "instagram/venue",
            supplied_by: "person:reviewer",
          },
          retrieved_at: "2026-07-28T10:00:00Z",
          text_source: "retrieved",
          text: "Show",
        },
        extractor: "tsv-parser@1",
        observations: [],
      }),
    );
    const errors: string[] = [];

    const exitCode = await runCli(["ingest", draftPath, incoming, root], {
      writeOut: () => undefined,
      writeError: (message) => errors.push(message),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("already exists");
    expect(await readFile(incoming, "utf8")).toBe("incoming");
    expect(await readFile(retained, "utf8")).toBe("retained");
  });

  it("rejects an unregistered Extractor before moving the Artefact", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "existing",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/existing.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "Existing",
    });
    const inbox = join(root, "data", "inbox");
    await mkdir(inbox);
    const artefact = join(inbox, "post.txt");
    await writeFile(artefact, "incoming");
    const draftPath = join(root, "draft.json");
    await writeFile(
      draftPath,
      JSON.stringify({
        document: {
          source: {
            value: "instagram/venue",
            supplied_by: "person:reviewer",
          },
          retrieved_at: "2026-07-28T10:00:00Z",
          text_source: "retrieved",
          text: "Show",
        },
        extractor: "unknown@1",
        observations: [],
      }),
    );
    const errors: string[] = [];

    const exitCode = await runCli(["ingest", draftPath, artefact, root], {
      writeOut: () => undefined,
      writeError: (message) => errors.push(message),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("unknown Extractor unknown@1");
    await expect(access(artefact)).resolves.toBeUndefined();
  });
});

describe("review command", () => {
  it("uses the CLI clock when no timestamp is supplied", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "event",
    });
    const output: string[] = [];

    const exitCode = await runCli(["review", root], {
      writeOut: (message) => output.push(message),
      writeError: () => undefined,
      now: () => Date.parse("2026-07-28T12:00:00Z"),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual(["[]"]);
  });

  it("renders the derived matching queue for a pinned clock", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source-a",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/a.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "event",
    });
    const secondDocumentId = "019fa69b-63ea-778b-953f-6f7a5bb62657";
    const firstObservationId = "019fa69b-63ea-778c-964c-a63e474676a5";
    const secondObservationId = "019fa69b-63ea-778d-964c-a63e474676a5";
    const firstEventId = "019fa69b-63ea-778e-8595-cd28e40852d1";
    const secondEventId = "019fa69b-63ea-778f-b0f1-8eb3f339794f";
    await writeFile(
      join(root, "data", "documents", "2026-08.jsonl"),
      `${JSON.stringify({
        type: "document",
        id: secondDocumentId,
        at: "2026-07-27T23:00:00Z",
        v: 1,
        source: "source-b",
        retrieved_at: "2026-07-27T23:00:00Z",
        text_source: "retrieved",
        artefact: "data/artefacts/b.txt",
        text_hash: "b".repeat(64),
        artefact_hash: "b".repeat(64),
        text: "event",
      })}\n`,
    );
    await writeFile(
      join(root, "data", "observations", "2026-07.jsonl"),
      [
        {
          type: "observation",
          id: firstObservationId,
          at: "2026-07-27T22:55:00Z",
          v: 1,
          document: documentId,
          extractor: "tsv-parser@1",
          subject: { kind: "event", id: firstEventId },
          claims: {
            date: { value: "2026-07-30", spans: ["event"] },
            venue_name: { value: "Sesc Pinheiros", spans: ["event"] },
          },
          extras: {},
        },
        {
          type: "observation",
          id: secondObservationId,
          at: "2026-07-27T23:00:00Z",
          v: 1,
          document: secondDocumentId,
          extractor: "tsv-parser@1",
          subject: { kind: "event", id: secondEventId },
          claims: {
            date: { value: "2026-07-30", spans: ["event"] },
            venue_name: {
              value: "Sesc Pinheiros (Auditório)",
              spans: ["event"],
            },
          },
          extras: {},
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
    );
    const output: string[] = [];

    const exitCode = await runCli(["review", "2026-07-28T12:00:00Z", root], {
      writeOut: (message) => output.push(message),
      writeError: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain(firstEventId);
    expect(output[0]).toContain(secondEventId);
  });
});

describe("pending command", () => {
  it("lists only inbox Artefacts whose bytes are not in the log", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/existing.txt",
      text_hash: digest,
      artefact_hash:
        "0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5",
      text: "Existing",
    });
    const inbox = join(root, "data", "inbox");
    await mkdir(inbox);
    await writeFile(join(inbox, "seen.txt"), "same");
    await writeFile(join(inbox, "new.txt"), "new");
    const output: string[] = [];

    const exitCode = await runCli(["pending", root], {
      writeOut: (message) => output.push(message),
      writeError: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual(["data/inbox/new.txt"]);
  });
});

describe("judge command", () => {
  it("mints and appends a validated Judgement", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "Show",
    });
    const draftPath = join(root, "judgement.json");
    await writeFile(
      draftPath,
      JSON.stringify({
        type: "override",
        entity: "source:source",
        field: "kind",
        value: "venue-channel",
        by: "person:reviewer",
        reason: "the Source is the Venue's own channel",
      }),
    );
    const output: string[] = [];

    const exitCode = await runCli(["judge", draftPath, root], {
      writeOut: (message) => output.push(message),
      writeError: () => undefined,
      now: () => Date.parse("2026-07-28T12:00:00Z"),
      randomBytes: (length) => new Uint8Array(length),
    });

    expect(exitCode).toBe(0);
    expect(output[0]).toMatch(/^Recorded override [0-9a-f-]+\.$/u);
    expect(
      await readFile(join(root, "data", "judgements", "2026-07.jsonl"), "utf8"),
    ).toContain('"entity":"source:source"');
  });

  it("rejects a Judgement that would violate log integrity", async () => {
    const root = await makeRepository({
      type: "document",
      id: documentId,
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "source",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.txt",
      text_hash: digest,
      artefact_hash: digest,
      text: "Show",
    });
    const draftPath = join(root, "judgement.json");
    await writeFile(
      draftPath,
      JSON.stringify({
        type: "match",
        subject: { kind: "observation", id: observationId },
        entity: `event:${documentId}`,
        verdict: "same",
        by: "person:reviewer",
      }),
    );
    const errors: string[] = [];

    const exitCode = await runCli(["judge", draftPath, root], {
      writeOut: () => undefined,
      writeError: (message) => errors.push(message),
      now: () => Date.parse("2026-07-28T12:00:00Z"),
      randomBytes: (length) => new Uint8Array(length),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/missing Observation/u);
    await expect(
      access(join(root, "data", "judgements", "2026-07.jsonl")),
    ).rejects.toThrow();
  });
});
