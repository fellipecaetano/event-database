import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createUuidV7Generator,
  fold,
  hashText,
  logRecordSchema,
  parseJsonLines,
  verifyLog,
  type FoldRules,
  type Judgement,
  type LogRecord,
} from "@event-database/core";

import { runCli } from "./main.js";

type CliOverrides = NonNullable<Parameters<typeof runCli>[1]>;

const temporaryDirectories: string[] = [];
const reviewedAt = "2026-07-28T12:00:00Z";
const decidedAt = "2026-07-28T15:00:00Z";
const decisionTime = "2026-07-28T15:00:00.000Z";
const partition = "2026-07.jsonl";
const reviewer = "person:reviewer";
const rules: FoldRules = {
  version: "test",
  extractorTrust: { "tsv-parser@1": 1 },
  sourceTrust: {},
  sourceTrustOverrides: {},
};
const id = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  documentC: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationA: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationB: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationC: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  eventA: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  eventB: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  eventC: "019fa69b-63ea-7792-93e2-9b0684b5f873",
  documentVenue: "019fa69b-63ea-7793-8b1c-1e5a1c3f0a01",
  venueA: "019fa69b-63ea-7794-9c2d-2f6b2d4e1b02",
  venueB: "019fa69b-63ea-7795-a3ef-3a7c3e5f2c03",
  observationVenueA: "019fa69b-63ea-7796-b4f0-4b8d4f602d04",
  observationVenueB: "019fa69b-63ea-7797-8501-5c9e50713e05",
  proposal: "019fa69b-63ea-7798-9612-6daf61824f06",
};

/** A Venue proposal standing in the log, plus the two Venues it spans. */
function proposalRecords(): LogRecord[] {
  const text = "Cine Joia CINE JOIA Praça Carlos Gomes, 82";
  const venueObservation = (
    observationId: string,
    venueId: string,
    name: string,
  ): LogRecord =>
    logRecordSchema.parse({
      type: "observation",
      id: observationId,
      at: "2026-07-27T12:00:00Z",
      v: 1,
      document: id.documentVenue,
      extractor: "tsv-parser@1",
      subject: { kind: "venue", id: venueId },
      claims: { venue_name: { value: name, spans: [name] } },
      extras: {},
    });
  return [
    logRecordSchema.parse({
      type: "document",
      id: id.documentVenue,
      at: "2026-07-27T12:00:00Z",
      v: 1,
      source: "google-maps",
      retrieved_at: "2026-07-27T12:00:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/google-maps.txt",
      text_hash: hashText(text),
      artefact_hash: "d".repeat(64),
      text,
    }),
    venueObservation(id.observationVenueA, id.venueA, "Cine Joia"),
    venueObservation(id.observationVenueB, id.venueB, "CINE JOIA"),
    logRecordSchema.parse({
      type: "match",
      id: id.proposal,
      at: "2026-07-27T13:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.observationVenueB },
      entity: `venue:${id.venueA}`,
      verdict: "same",
      by: "matcher@1",
      proposed: true,
      reason: "raised by a confirmed Event merge",
    }),
  ];
}

interface EventFixture {
  readonly documentId: string;
  readonly observationId: string;
  readonly eventId: string;
  readonly source: string;
  readonly artefactHash: string;
  readonly text: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly publishedAt?: string;
}

const eventFixtures: readonly EventFixture[] = [
  {
    documentId: id.documentA,
    observationId: id.observationA,
    eventId: id.eventA,
    source: "cine-joia",
    artefactHash: "a".repeat(64),
    text: "Terno Rei 30/07 20h Cine Joia — casa de shows no centro",
    publishedAt: "2026-07-24T09:00:00Z",
    claims: {
      title: { value: "Terno Rei", spans: ["Terno Rei"] },
      date: { value: "2026-07-30", spans: ["30/07"] },
      start: { value: "2026-07-30T20:00", spans: ["20h"] },
      venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
    },
  },
  {
    documentId: id.documentB,
    observationId: id.observationB,
    eventId: id.eventB,
    source: "ticket-site",
    artefactHash: "b".repeat(64),
    text: "Terno Rei — Cine Joia — 30 de julho 21h — bilheteria online do site",
    claims: {
      title: { value: "Terno Rei", spans: ["Terno Rei"] },
      date: { value: "2026-07-30", spans: ["30 de julho"] },
      start: { value: "2026-07-30T21:00", spans: ["21h"] },
      venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
    },
  },
  {
    documentId: id.documentC,
    observationId: id.observationC,
    eventId: id.eventC,
    source: "listings",
    artefactHash: "c".repeat(64),
    text: "Terno Rei no Cine Joia dia 30/07 — agenda semanal da cidade",
    claims: {
      title: { value: "Terno Rei", spans: ["Terno Rei"] },
      date: { value: "2026-07-30", spans: ["30/07"] },
      venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
    },
  },
];

function fixtureRecords(eventCount: number): LogRecord[] {
  return eventFixtures.slice(0, eventCount).flatMap((fixture) => [
    logRecordSchema.parse({
      type: "document",
      id: fixture.documentId,
      at: "2026-07-27T12:00:00Z",
      v: 1,
      source: fixture.source,
      ...(fixture.publishedAt === undefined
        ? {}
        : { published_at: fixture.publishedAt }),
      retrieved_at: "2026-07-27T12:00:00Z",
      text_source: "retrieved",
      artefact: `data/artefacts/${fixture.source}.txt`,
      text_hash: hashText(fixture.text),
      artefact_hash: fixture.artefactHash,
      text: fixture.text,
    }),
    logRecordSchema.parse({
      type: "observation",
      id: fixture.observationId,
      at: "2026-07-27T12:00:00Z",
      v: 1,
      document: fixture.documentId,
      extractor: "tsv-parser@1",
      subject: { kind: "event", id: fixture.eventId },
      claims: fixture.claims,
      extras: {},
    }),
  ]);
}

async function makeRepository(
  eventCount = 2,
  extra: readonly LogRecord[] = [],
): Promise<{ readonly root: string; readonly records: LogRecord[] }> {
  const root = await mkdtemp(join(tmpdir(), "event-database-review-"));
  temporaryDirectories.push(root);
  for (const directory of ["documents", "observations", "judgements"]) {
    await mkdir(join(root, "data", directory), { recursive: true });
  }
  const records = [...fixtureRecords(eventCount), ...extra];
  const write = async (
    directory: string,
    kind: LogRecord["type"],
  ): Promise<void> => {
    const lines = records
      .filter((record) => record.type === kind)
      .map((record) => JSON.stringify(record));
    await writeFile(
      join(root, "data", directory, partition),
      `${lines.join("\n")}\n`,
    );
  };
  await write("documents", "document");
  await write("observations", "observation");
  if (records.some((record) => record.type === "match")) {
    await write("judgements", "match");
  }
  return { root, records };
}

interface Session {
  /** Everything the reviewer sees, prompts and output interleaved in order. */
  readonly transcript: string[];
  readonly errors: string[];
  readonly dependencies: CliOverrides;
  readonly isClosed: () => boolean;
}

function session(
  answers: readonly string[],
  {
    isInteractive = true,
    ...overrides
  }: CliOverrides & { readonly isInteractive?: boolean } = {},
): Session {
  const transcript: string[] = [];
  const errors: string[] = [];
  const pending = [...answers];
  let closed = false;
  return {
    transcript,
    errors,
    isClosed: () => closed,
    dependencies: {
      writeOut: (message) => transcript.push(message),
      writeError: (message) => errors.push(message),
      now: () => Date.parse(decidedAt),
      randomBytes: (length) => new Uint8Array(length),
      createTerminal: () => ({
        isInteractive,
        question: (prompt) => {
          transcript.push(prompt);
          return Promise.resolve(pending.shift());
        },
        close: () => {
          closed = true;
        },
      }),
      ...overrides,
    },
  };
}

/** The first Judgement id a session mints, given the injected clock and bytes. */
function firstMintedId(): string {
  return createUuidV7Generator({
    now: () => Date.parse(decidedAt),
    randomBytes: (length) => new Uint8Array(length),
  })();
}

function interactiveArguments(root: string, by = reviewer): string[] {
  return ["review", "--interactive", "--by", by, "--repository", root];
}

/**
 * The Event ids of each case as the reviewer saw it, before deciding.
 *
 * This deliberately depends on the rendering format the plan fixes by example:
 * a case opens with a `Case ` header, each side names `event:<uuid>`, and the
 * decision prompt says `Decision`. That format is a contract, not an accident.
 */
function reviewedPairs(transcript: readonly string[]): string[][] {
  const pairs: string[][] = [];
  let collecting = false;
  for (const line of transcript) {
    if (line.startsWith("Case ")) {
      pairs.push([]);
      collecting = true;
    } else if (line.includes("Decision")) {
      collecting = false;
    }
    const current = pairs.at(-1);
    if (!collecting || current === undefined) {
      continue;
    }
    for (const [, eventId] of line.matchAll(/event:([0-9a-f-]{36})/gu)) {
      if (eventId !== undefined && !current.includes(eventId)) {
        current.push(eventId);
      }
    }
  }
  return pairs;
}

function lineIndex(transcript: readonly string[], needle: string): number {
  return transcript.findIndex((line) => line.includes(needle));
}

async function readJudgements(root: string): Promise<Judgement[]> {
  const path = join(root, "data", "judgements", partition);
  const records = parseJsonLines(await readFile(path, "utf8"), path);
  return records.filter(
    (record): record is Judgement =>
      record.type !== "document" && record.type !== "observation",
  );
}

async function judgementsWritten(root: string): Promise<boolean> {
  try {
    await access(join(root, "data", "judgements", partition));
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("review command options", () => {
  it("accepts the valueless --interactive flag in any option order", async () => {
    const { root } = await makeRepository();
    const trailing = session(["q"]);

    const exitCode = await runCli(
      ["review", "--by", reviewer, "--repository", root, "--interactive"],
      trailing.dependencies,
    );

    expect(trailing.errors).toEqual([]);
    expect(exitCode).toBe(0);
    expect(reviewedPairs(trailing.transcript)).toHaveLength(1);
  });

  it("rejects --by outside interactive mode", async () => {
    const { root } = await makeRepository();
    const { errors, dependencies } = session([]);

    const exitCode = await runCli(
      ["review", "--by", reviewer, "--repository", root],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/--by/u);
    expect(errors[0]).not.toMatch(/^Usage:/u);
  });

  it("rejects a reviewer who is not a person", async () => {
    const { root } = await makeRepository();
    const { errors, dependencies } = session([]);

    const exitCode = await runCli(
      interactiveArguments(root, "alice"),
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/person:/u);
    expect(errors[0]).toContain("alice");
  });

  it("refuses interactive review without a terminal", async () => {
    const { root } = await makeRepository();
    const { errors, isClosed, dependencies } = session([], {
      isInteractive: false,
    });

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/terminal/iu);
    expect(await judgementsWritten(root)).toBe(false);
    expect(isClosed()).toBe(true);
  });

  it("asks for the reviewer once a session, insisting on a person", async () => {
    const { root } = await makeRepository(3);
    const { transcript, dependencies } = session([
      "alice",
      reviewer,
      "d",
      "",
      "d",
      "",
    ]);

    const exitCode = await runCli(
      ["review", "--interactive", "--repository", root],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(await readJudgements(root)).toHaveLength(2);
    expect(transcript.filter((line) => /reviewer/iu.test(line))).toHaveLength(
      2,
    );
    expect(
      (await readJudgements(root)).map((record) =>
        "by" in record ? record.by : undefined,
      ),
    ).toEqual([reviewer, reviewer]);
  });
});

describe("interactive review presentation", () => {
  it("shows both sides and their Sources before asking for a decision", async () => {
    const { root } = await makeRepository();
    const { transcript, dependencies } = session(["q"]);

    await runCli(interactiveArguments(root), dependencies);
    const shown = transcript.join("\n");

    expect(shown).toMatch(new RegExp(`A[^\\n]*event:${id.eventA}`, "u"));
    expect(shown).toMatch(new RegExp(`B[^\\n]*event:${id.eventB}`, "u"));
    for (const detail of [
      "Terno Rei",
      "Cine Joia",
      "20h",
      "21h",
      "cine-joia",
      "ticket-site",
    ]) {
      expect(shown).toContain(detail);
    }
    for (const control of [
      /\[s\]ame/u,
      /\[d\]ifferent/u,
      /de\[f\]er/u,
      /s\[k\]ip/u,
      /\[v\]iew sources/u,
      /\[q\]uit/u,
    ]) {
      expect(shown).toMatch(control);
    }
  });

  it("shows each side's own date and Observation count, not just the header's", async () => {
    const nightOneEventId = "019fa69b-63ea-7793-8000-000000000010";
    const nightTwoEventId = "019fa69b-63ea-7794-8000-000000000011";
    const nightOneDocumentId = "019fa69b-63ea-7795-8000-000000000012";
    const nightTwoDocumentId = "019fa69b-63ea-7796-8000-000000000013";
    const nightOneObservationId = "019fa69b-63ea-7797-8000-000000000014";
    const nightTwoObservationId = "019fa69b-63ea-7798-8000-000000000015";
    const nightOneText = "Terno Rei no Cine Joia dia 30/07";
    const nightTwoText = "Terno Rei no Cine Joia dia 31/07";
    const { root } = await makeRepository(0, [
      logRecordSchema.parse({
        type: "document",
        id: nightOneDocumentId,
        at: "2026-07-27T12:00:00Z",
        v: 1,
        source: "cine-joia",
        retrieved_at: "2026-07-27T12:00:00Z",
        text_source: "retrieved",
        artefact: "data/artefacts/cine-joia.txt",
        text_hash: hashText(nightOneText),
        artefact_hash: "e".repeat(64),
        text: nightOneText,
      }),
      logRecordSchema.parse({
        type: "observation",
        id: nightOneObservationId,
        at: "2026-07-27T12:00:00Z",
        v: 1,
        document: nightOneDocumentId,
        extractor: "tsv-parser@1",
        subject: { kind: "event", id: nightOneEventId },
        claims: {
          title: { value: "Terno Rei", spans: ["Terno Rei"] },
          date: { value: "2026-07-30", spans: ["30/07"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
        extras: {},
      }),
      logRecordSchema.parse({
        type: "document",
        id: nightTwoDocumentId,
        at: "2026-07-27T12:00:00Z",
        v: 1,
        source: "ticket-site",
        retrieved_at: "2026-07-27T12:00:00Z",
        text_source: "retrieved",
        artefact: "data/artefacts/ticket-site.txt",
        text_hash: hashText(nightTwoText),
        artefact_hash: "f".repeat(64),
        text: nightTwoText,
      }),
      logRecordSchema.parse({
        type: "observation",
        id: nightTwoObservationId,
        at: "2026-07-27T12:00:00Z",
        v: 1,
        document: nightTwoDocumentId,
        extractor: "tsv-parser@1",
        subject: { kind: "event", id: nightTwoEventId },
        claims: {
          title: { value: "Terno Rei", spans: ["Terno Rei"] },
          date: { value: "2026-07-31", spans: ["31/07"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
        extras: {},
      }),
    ]);
    const { transcript, dependencies } = session(["q"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    const shown = transcript.join("\n");
    // The header carries only the earlier of the two dates; each side must
    // also carry its own, or a night-apart pair renders as if same-night.
    expect(shown).toContain("2026-07-30");
    expect(shown).toContain("2026-07-31");
    expect(shown).toContain("1 Observation");
  });

  it("keeps whole Documents out of the default view until asked", async () => {
    const { root } = await makeRepository();
    const { transcript, dependencies } = session(["v", "d", ""]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    const firstPrompt = lineIndex(transcript, "Decision");
    expect(lineIndex(transcript, "casa de shows no centro")).toBeGreaterThan(
      firstPrompt,
    );
    expect(lineIndex(transcript, "bilheteria online do site")).toBeGreaterThan(
      firstPrompt,
    );
    expect(transcript.filter((line) => line.includes("Decision"))).toHaveLength(
      2,
    );
  });

  it("reprompts on an unknown or empty answer", async () => {
    const { root } = await makeRepository();
    const { transcript, dependencies } = session(["x", "", "d", ""]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(transcript.filter((line) => line.includes("Decision"))).toHaveLength(
      3,
    );
  });

  it("reveals what the matcher concluded only once the decision is recorded", async () => {
    const { root } = await makeRepository();
    const { transcript, dependencies } = session(["d", ""]);

    await runCli(interactiveArguments(root), dependencies);
    const decisionPrompt = lineIndex(transcript, "Decision");
    const beforeDeciding = transcript.slice(0, decisionPrompt + 1).join("\n");

    for (const machineWord of ["same-venue", "shared-act", "impact", "score"]) {
      expect(beforeDeciding).not.toContain(machineWord);
    }
    expect(lineIndex(transcript, "same-venue")).toBeGreaterThan(decisionPrompt);
  });
});

describe("interactive review decisions", () => {
  it("shows and merges a direct Venue pair", async () => {
    const { root } = await makeRepository(0, proposalRecords().slice(0, 3));
    const { transcript, dependencies } = session(["s", "", "a"]);

    expect(await runCli(interactiveArguments(root), dependencies)).toBe(0);

    const shown = transcript.join("\n");
    expect(shown).toContain(`A — venue:${id.venueA}`);
    expect(shown).toContain(`B — venue:${id.venueB}`);
    expect(shown).toContain("Surviving Venue");
    expect(await readJudgements(root)).toEqual([
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "same",
      }),
      expect.objectContaining({
        type: "redirect",
        from: `venue:${id.venueB}`,
        to: `venue:${id.venueA}`,
      }),
    ]);
  });

  it.each(["different", "deferred"] as const)(
    "records one %s Match against the pair",
    async (verdict) => {
      const { root } = await makeRepository();
      const key = verdict === "different" ? "d" : "f";
      const { dependencies } = session([key, "the start times differ"]);

      const exitCode = await runCli(interactiveArguments(root), dependencies);

      expect(exitCode).toBe(0);
      expect(await readJudgements(root)).toEqual([
        expect.objectContaining({
          type: "match",
          id: firstMintedId(),
          subject: { kind: "observation", id: id.observationA },
          entity: `event:${id.eventB}`,
          verdict,
          by: reviewer,
          reason: "the start times differ",
          at: decisionTime,
        }),
      ]);
    },
  );

  it("merges into the confirmed survivor and retires the other Event", async () => {
    const { root } = await makeRepository();
    const { dependencies } = session(["s", "", "a"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(await readJudgements(root)).toEqual([
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationB },
        entity: `event:${id.eventA}`,
        verdict: "same",
      }),
      expect.objectContaining({
        type: "redirect",
        from: `event:${id.eventB}`,
        to: `event:${id.eventA}`,
        reason: "merged",
      }),
    ]);
  });

  it("merges the other way when the reviewer chooses side B", async () => {
    const { root } = await makeRepository();
    const { dependencies } = session([
      "s",
      "the ticket page is the same show",
      "b",
    ]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(await readJudgements(root)).toContainEqual(
      expect.objectContaining({
        type: "redirect",
        from: `event:${id.eventA}`,
        to: `event:${id.eventB}`,
        reason: "the ticket page is the same show",
      }),
    );
  });

  it("does not take an empty answer as the default survivor", async () => {
    const { root } = await makeRepository();
    const { dependencies } = session(["s", "", "", "b"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(await readJudgements(root)).toContainEqual(
      expect.objectContaining({
        type: "redirect",
        from: `event:${id.eventA}`,
        to: `event:${id.eventB}`,
      }),
    );
  });

  it("writes nothing when the reviewer disappears at the survivor step", async () => {
    const { root } = await makeRepository();
    const { isClosed, dependencies } = session(["s", ""]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(await judgementsWritten(root)).toBe(false);
    expect(isClosed()).toBe(true);
  });

  it("stops cleanly on quit without recording anything", async () => {
    const { root } = await makeRepository();
    const { transcript, errors, isClosed, dependencies } = session(["q"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(errors).toEqual([]);
    expect(exitCode).toBe(0);
    expect(await judgementsWritten(root)).toBe(false);
    expect(isClosed()).toBe(true);
    expect(transcript.at(-1)).toMatch(/skipped 0/u);
  });

  it("summarises the session by outcome", async () => {
    const { root } = await makeRepository(3);
    const { transcript, dependencies } = session(["k", "d", "", "f", ""]);

    await runCli(interactiveArguments(root), dependencies);
    const summary = transcript.at(-1) ?? "";

    expect(summary).toMatch(/same 0/u);
    expect(summary).toMatch(/different 1/u);
    expect(summary).toMatch(/deferred 1/u);
    expect(summary).toMatch(/skipped 1/u);
  });
});

describe("interactive review queue", () => {
  it("rebuilds the queue from the log after a merge", async () => {
    const { root } = await makeRepository(3);
    const { transcript, dependencies } = session(["s", "", "a"]);

    await runCli(interactiveArguments(root), dependencies);

    expect(reviewedPairs(transcript)).toEqual([
      [id.eventA, id.eventB],
      [id.eventA, id.eventC],
    ]);
  });

  it("does not bring a skipped pair back in the same session", async () => {
    const { root } = await makeRepository();
    const { transcript, dependencies } = session(["k"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(reviewedPairs(transcript)).toEqual([[id.eventA, id.eventB]]);
    expect(await judgementsWritten(root)).toBe(false);
  });

  it("records the decision at the real clock, not the review timestamp", async () => {
    const { root } = await makeRepository();
    const { dependencies } = session(["d", ""], {
      now: () => Date.parse("2026-08-01T09:00:00Z"),
    });

    const exitCode = await runCli(
      [
        "review",
        "--interactive",
        "--by",
        reviewer,
        "--at",
        reviewedAt,
        "--repository",
        root,
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    const path = join(root, "data", "judgements", "2026-08.jsonl");
    expect(parseJsonLines(await readFile(path, "utf8"), path)).toEqual([
      expect.objectContaining({ at: "2026-08-01T09:00:00.000Z" }),
    ]);
  });

  it("rejects an invalid --at in interactive mode too", async () => {
    const { root } = await makeRepository();
    const { errors, dependencies } = session([]);

    const exitCode = await runCli(
      [
        "review",
        "--interactive",
        "--by",
        reviewer,
        "--at",
        "not-a-timestamp",
        "--repository",
        root,
      ],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["invalid review timestamp: not-a-timestamp"]);
  });
});

describe("interactive review failure safety", () => {
  it("records nothing when the batch would fail verification", async () => {
    const colliding = firstMintedId();
    const { root } = await makeRepository(2, [
      logRecordSchema.parse({
        type: "document",
        id: colliding,
        at: "2026-07-27T12:00:00Z",
        v: 1,
        source: "stray",
        retrieved_at: "2026-07-27T12:00:00Z",
        text_source: "retrieved",
        artefact: "data/artefacts/stray.txt",
        text_hash: hashText("stray"),
        artefact_hash: "d".repeat(64),
        text: "stray",
      }),
    ]);
    const { transcript, errors, isClosed, dependencies } = session(["d", ""]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(1);
    expect(errors[0]).toMatch(/duplicate-record-id/u);
    expect(await judgementsWritten(root)).toBe(false);
    expect(transcript.join("\n")).not.toContain("same-venue");
    expect(isClosed()).toBe(true);
  });

  it("keeps an earlier completed case when a later append fails", async () => {
    const { root, records } = await makeRepository(3);
    const appends: string[] = [];
    const { errors, isClosed, dependencies } = session(
      ["s", "", "a", "d", "the start times differ"],
      {
        appendFile: async (path, data) => {
          appends.push(data);
          if (appends.length > 1) {
            throw new Error("simulated write failure");
          }
          await appendFile(path, data, "utf8");
        },
      },
    );

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("simulated write failure");
    expect(isClosed()).toBe(true);
    // One append per case: the merge's Match and Redirect went out together.
    expect(appends).toHaveLength(2);
    const kept = await readJudgements(root);
    expect(kept.map((record) => record.type)).toEqual(["match", "redirect"]);
    expect(kept.every((record) => record.at === decisionTime)).toBe(true);
    expect(verifyLog([...records, ...kept])).toEqual([]);
  });

  it("keeps completed cases and drops the incomplete one on EOF", async () => {
    const { root } = await makeRepository(3);
    const { isClosed, dependencies } = session(["d", "", "s"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    expect(await readJudgements(root)).toEqual([
      expect.objectContaining({ type: "match", verdict: "different" }),
    ]);
    expect(isClosed()).toBe(true);
  });
});

describe("interactive review integration", () => {
  it("appends a merge that the log can be reread and verified with", async () => {
    const { root, records } = await makeRepository();
    const { dependencies } = session(["s", "one show, two listings", "a"]);

    const exitCode = await runCli(interactiveArguments(root), dependencies);

    expect(exitCode).toBe(0);
    const appended = await readJudgements(root);
    const log = [...records, ...appended];
    expect(verifyLog(log)).toEqual([]);
    const catalogue = fold(log, { now: new Date(reviewedAt), rules });
    expect(catalogue.events).toEqual([
      expect.objectContaining({
        id: id.eventA,
        observationIds: [id.observationA, id.observationB],
      }),
    ]);
  });
});

describe("interactive review of standing proposals", () => {
  it("shows a proposal, what raised it, and both Venues", async () => {
    const { root } = await makeRepository(0, proposalRecords());
    const walk = session(["q"]);

    await runCli(interactiveArguments(root), walk.dependencies);

    const header = walk.transcript.find((line) => line.startsWith("Case "));
    expect(header).toContain("proposal raised by matcher@1");
    expect(walk.transcript.join("\n")).toContain(
      "raised by a confirmed Event merge",
    );
    expect(lineIndex(walk.transcript, id.venueA)).toBeGreaterThan(-1);
    expect(lineIndex(walk.transcript, id.venueB)).toBeGreaterThan(-1);
    expect(lineIndex(walk.transcript, "[s] confirm")).toBeGreaterThan(-1);
  });

  it("never asks which side survives — the proposal names its direction", async () => {
    const { root } = await makeRepository(0, proposalRecords());
    const walk = session(["s", "one room, two spellings"]);

    await runCli(interactiveArguments(root), walk.dependencies);

    expect(lineIndex(walk.transcript, "Surviving")).toBe(-1);
  });

  it("confirming merges the Venue and clears the proposal from the queue", async () => {
    const { root } = await makeRepository(0, proposalRecords());
    const walk = session(["s", "one room, two spellings"]);

    const exitCode = await runCli(
      interactiveArguments(root),
      walk.dependencies,
    );

    expect(exitCode).toBe(0);
    const written = (await readJudgements(root)).filter(
      (record) => record.id !== id.proposal,
    );
    expect(written).toEqual([
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "same",
        by: reviewer,
        reason: "one room, two spellings",
      }),
      expect.objectContaining({
        type: "redirect",
        from: `venue:${id.venueB}`,
        to: `venue:${id.venueA}`,
      }),
    ]);
    for (const record of written) {
      expect(record).not.toHaveProperty("proposed");
    }
  });

  it("rejecting settles the proposal without merging anything", async () => {
    const { root } = await makeRepository(0, proposalRecords());
    const walk = session(["d", "two different rooms"]);

    await runCli(interactiveArguments(root), walk.dependencies);

    const written = (await readJudgements(root)).filter(
      (record) => record.id !== id.proposal,
    );
    expect(written).toEqual([
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "different",
        reason: "two different rooms",
      }),
    ]);
  });

  it("leaves the log valid and the queue empty once answered", async () => {
    const { root } = await makeRepository(0, proposalRecords());

    await runCli(interactiveArguments(root), session(["d", ""]).dependencies);

    const queue = session([]);
    await runCli(["review", "--repository", root], queue.dependencies);
    expect(JSON.parse(queue.transcript[0] ?? "[]")).toEqual([]);
  });
});
