#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  LogParseError,
  buildReviewQueue,
  createUuidV7Generator,
  hashBytes,
  ingestDraftSchema,
  judgementDraftSchema,
  parseJsonLines,
  prepareIngest,
  prepareJudgement,
  verifyLog,
  type Document,
  type IngestDraft,
  type JudgementDraft,
  type FoldRules,
  type LogRecord,
} from "@event-database/core";

interface CliDependencies {
  readonly writeOut: (message: string) => void;
  readonly writeError: (message: string) => void;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}

const defaultDependencies: CliDependencies = {
  writeOut: (message) => {
    process.stdout.write(`${message}\n`);
  },
  writeError: (message) => {
    console.error(message);
  },
  now: Date.now,
  randomBytes: (length) => randomBytes(length),
};

const knownExtractors = new Set(["claude-opus-5/manual@draft", "tsv-parser@1"]);
const foldRules: FoldRules = {
  version: "working-tree",
  extractorTrust: {
    "claude-opus-5/manual@draft": 1,
    "tsv-parser@1": 2,
  },
};
const yearMonthLength = 7;
const executableArgumentCount = 2;

export async function runCli(
  arguments_: readonly string[],
  suppliedDependencies: Partial<CliDependencies> = {},
): Promise<number> {
  const dependencies = {
    ...defaultDependencies,
    ...suppliedDependencies,
  };
  const [command] = arguments_;

  try {
    if (command === "verify") {
      return await runVerify(arguments_.slice(1), dependencies);
    }
    if (command === "ingest") {
      return await runIngest(arguments_.slice(1), dependencies);
    }
    if (command === "review") {
      return await runReview(arguments_.slice(1), dependencies);
    }
    if (command === "pending") {
      return await runPending(arguments_.slice(1), dependencies);
    }
    if (command === "judge") {
      return await runJudge(arguments_.slice(1), dependencies);
    }
    dependencies.writeError(
      "Usage: event-database <ingest|judge|pending|review|verify> [arguments]",
    );
    return 1;
  } catch (error) {
    dependencies.writeError(
      error instanceof Error ? error.message : "unknown command failure",
    );
    return 1;
  }
}

async function runJudge(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [draftPath, root = process.cwd()] = arguments_;
  if (draftPath === undefined) {
    dependencies.writeError(
      "Usage: event-database judge <draft.json> [repository]",
    );
    return 1;
  }
  const text = await readFile(draftPath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid Judgement draft JSON: ${draftPath}`, {
      cause: error,
    });
  }
  const draft: JudgementDraft = judgementDraftSchema.parse(value);
  const at = new Date(dependencies.now()).toISOString();
  const judgement = prepareJudgement(draft, {
    at,
    id: createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    })(),
  });
  const issues = verifyLog([...(await readLog(root)), judgement], {
    knownExtractors,
  });
  if (issues.length > 0) {
    throw new Error(
      `cannot record Judgement: ${issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const partition = at.slice(0, yearMonthLength);
  await appendRecords(join(root, "data", "judgements", `${partition}.jsonl`), [
    judgement,
  ]);
  dependencies.writeOut(`Recorded ${judgement.type} ${judgement.id}.`);
  return 0;
}

async function runPending(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [root = process.cwd()] = arguments_;
  const records = await readLog(root);
  const heldHashes = new Set(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => document.artefact_hash),
  );
  const inbox = join(root, "data", "inbox");
  const entries = await readdir(inbox, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }
    const path = join(inbox, entry.name);
    const hash = hashBytes(await readFile(path));
    if (!heldHashes.has(hash)) {
      dependencies.writeOut(relative(root, path));
    }
  }
  return 0;
}

async function runReview(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [firstArgument, secondArgument] = arguments_;
  let now = new Date(dependencies.now());
  let root = process.cwd();
  if (firstArgument !== undefined) {
    const suppliedClock = new Date(firstArgument);
    if (Number.isNaN(suppliedClock.valueOf())) {
      root = firstArgument;
    } else {
      now = suppliedClock;
      root = secondArgument ?? root;
    }
  }

  const records = await readLog(root);
  const issues = verifyLog(records, { knownExtractors });
  if (issues.length > 0) {
    throw new Error(
      `cannot build review queue: log has ${String(issues.length)} verification issue(s)`,
    );
  }
  dependencies.writeOut(
    JSON.stringify(buildReviewQueue(records, { now, rules: foldRules })),
  );
  return 0;
}

async function runVerify(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [root = process.cwd()] = arguments_;
  const records = await readLog(root);
  const artefactHashes = await readArtefactHashes(root, records);
  const issues = verifyLog(records, { artefactHashes, knownExtractors });
  if (issues.length > 0) {
    for (const issue of issues) {
      dependencies.writeError(
        `${issue.code}: ${issue.recordId}: ${issue.message}`,
      );
    }
    return 1;
  }

  const noun = records.length === 1 ? "record" : "records";
  dependencies.writeOut(`Verified ${String(records.length)} ${noun}.`);
  return 0;
}

async function readArtefactHashes(
  root: string,
  records: readonly LogRecord[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const document of records.filter(
    (record): record is Document => record.type === "document",
  )) {
    try {
      hashes.set(
        document.artefact,
        hashBytes(await readFile(join(root, document.artefact))),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  return hashes;
}

async function runIngest(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [draftPath, artefactPath, root = process.cwd()] = arguments_;
  if (draftPath === undefined || artefactPath === undefined) {
    dependencies.writeError(
      "Usage: event-database ingest <draft.json> <artefact> [repository]",
    );
    return 1;
  }

  assertInboxArtefact(root, artefactPath);
  const artefactBytes = await readFile(artefactPath);
  const artefactHash = hashBytes(artefactBytes);
  const existingRecords = await readLog(root);
  const existingDocument = existingRecords.find(
    (record): record is Document =>
      record.type === "document" && record.artefact_hash === artefactHash,
  );
  if (existingDocument !== undefined) {
    throw new Error(
      `refusing to ingest: that Artefact is already Document ${existingDocument.id}`,
    );
  }

  const draftText = await readFile(draftPath, "utf8");
  let draftValue: unknown;
  try {
    draftValue = JSON.parse(draftText);
  } catch (error) {
    throw new Error(`invalid ingest draft JSON: ${draftPath}`, {
      cause: error,
    });
  }
  const draft: IngestDraft = ingestDraftSchema.parse(draftValue);
  if (!knownExtractors.has(draft.extractor)) {
    throw new Error(`unknown Extractor ${draft.extractor}`);
  }
  const at = new Date(dependencies.now()).toISOString();
  const destination = join(root, "data", "artefacts", basename(artefactPath));
  await assertPathAbsent(destination);
  const prepared = prepareIngest(draft, {
    at,
    artefact: relative(root, destination),
    artefactHash,
    nextId: createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    }),
  });

  await mkdir(join(root, "data", "artefacts"), { recursive: true });
  await rename(artefactPath, destination);
  const partition = at.slice(0, yearMonthLength);
  await appendRecords(join(root, "data", "documents", `${partition}.jsonl`), [
    prepared.document,
  ]);
  await appendRecords(
    join(root, "data", "observations", `${partition}.jsonl`),
    prepared.observations,
  );

  const noun =
    prepared.observations.length === 1 ? "Observation" : "Observations";
  dependencies.writeOut(
    `Ingested Document ${prepared.document.id} with ${String(prepared.observations.length)} ${noun}.`,
  );
  return 0;
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`Artefact destination already exists: ${path}`);
}

function assertInboxArtefact(root: string, artefactPath: string): void {
  const inbox = join(root, "data", "inbox");
  const fromInbox = relative(inbox, artefactPath);
  if (
    fromInbox.length === 0 ||
    fromInbox.startsWith("..") ||
    isAbsolute(fromInbox)
  ) {
    throw new Error(`Artefact must be inside ${inbox}`);
  }
}

async function appendRecords(
  path: string,
  records: readonly LogRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await appendFile(path, `${lines}\n`, "utf8");
}

async function readLog(root: string): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  for (const directory of ["documents", "observations", "judgements"]) {
    const path = join(root, "data", directory);
    const entries = await readdir(path, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const file of files) {
      const filePath = join(path, file.name);
      const text = await readFile(filePath, "utf8");
      records.push(...parseJsonLines(text, relative(root, filePath)));
    }
  }
  return records;
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  process.exitCode = await runCli(process.argv.slice(executableArgumentCount));
}

export { LogParseError };
