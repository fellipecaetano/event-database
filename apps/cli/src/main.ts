#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  truncate,
  unlink,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  LogParseError,
  buildReviewQueue,
  createUuidV7Generator,
  hashBytes,
  judgementDraftSchema,
  parseJsonLines,
  prepareIngest,
  prepareJudgement,
  prepareReextraction,
  sourceTrustProfiles,
  verifyLog,
  type Document,
  type JudgementDraft,
  type FoldRules,
  type LogRecord,
} from "@event-database/core";

interface CliDependencies {
  readonly writeOut: (message: string) => void;
  readonly writeError: (message: string) => void;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly appendFile: (path: string, data: string) => Promise<void>;
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
  appendFile: async (path, data) => appendFile(path, data, "utf8"),
};

const foldRules: FoldRules = {
  version: "working-tree",
  extractorTrust: {
    "claude-opus-5/manual@draft": 1,
    "tsv-parser@1": 2,
  },
  sourceTrust: sourceTrustProfiles,
  sourceTrustOverrides: {},
};
const knownExtractors = new Set(Object.keys(foldRules.extractorTrust));
const yearMonthLength = 7;
const executableArgumentCount = 2;
const reviewOptionArgumentCount = 2;
const reviewUsage =
  "Usage: event-database review [--at <timestamp>] [--repository <path>]";

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
    if (command === "reextract") {
      return await runReextract(arguments_.slice(1), dependencies);
    }
    if (command === "pending") {
      return await runPending(arguments_.slice(1), dependencies);
    }
    if (command === "judge") {
      return await runJudge(arguments_.slice(1), dependencies);
    }
    dependencies.writeError(
      "Usage: event-database <ingest|judge|pending|reextract|review|verify> [arguments]",
    );
    return 1;
  } catch (error) {
    dependencies.writeError(
      error instanceof Error ? error.message : "unknown command failure",
    );
    return 1;
  }
}

async function runReextract(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [draftPath, root = process.cwd()] = arguments_;
  if (draftPath === undefined) {
    dependencies.writeError(
      "Usage: event-database reextract <draft.json> [repository]",
    );
    return 1;
  }
  const existingRecords = await readLog(root);
  const text = await readFile(draftPath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid re-extraction draft JSON: ${draftPath}`, {
      cause: error,
    });
  }
  const at = new Date(dependencies.now()).toISOString();
  const observations = prepareReextraction(value, {
    at,
    existingRecords,
    extractorTrust: foldRules.extractorTrust,
    nextId: createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    }),
  });
  const issues = verifyLog([...existingRecords, ...observations], {
    knownExtractors,
  });
  if (issues.length > 0) {
    throw new Error(
      `cannot re-extract: ${issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const partition = at.slice(0, yearMonthLength);
  await appendRecords(
    join(root, "data", "observations", `${partition}.jsonl`),
    observations,
    dependencies.appendFile,
  );
  dependencies.writeOut(
    `Re-extracted ${String(observations.length)} Observations.`,
  );
  return 0;
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
  await appendRecords(
    join(root, "data", "judgements", `${partition}.jsonl`),
    [judgement],
    dependencies.appendFile,
  );
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
  let now = new Date(dependencies.now());
  let root = process.cwd();
  for (
    let index = 0;
    index < arguments_.length;
    index += reviewOptionArgumentCount
  ) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new Error(reviewUsage);
    }
    if (option === "--at") {
      now = new Date(value);
      if (Number.isNaN(now.valueOf())) {
        throw new Error(`invalid review timestamp: ${value}`);
      }
    } else if (option === "--repository") {
      root = value;
    } else {
      throw new Error(reviewUsage);
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

  const draftText = await readFile(draftPath, "utf8");
  let draftValue: unknown;
  try {
    draftValue = JSON.parse(draftText);
  } catch (error) {
    throw new Error(`invalid ingest draft JSON: ${draftPath}`, {
      cause: error,
    });
  }
  const at = new Date(dependencies.now()).toISOString();
  const destination = join(root, "data", "artefacts", basename(artefactPath));
  await assertPathAbsent(destination);
  const prepared = prepareIngest(draftValue, {
    at,
    artefact: relative(root, destination),
    artefactHash,
    existingRecords,
    extractorTrust: foldRules.extractorTrust,
    nextId: createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    }),
  });

  await mkdir(join(root, "data", "artefacts"), { recursive: true });
  const partition = at.slice(0, yearMonthLength);
  const documentPath = join(root, "data", "documents", `${partition}.jsonl`);
  const observationPath = join(
    root,
    "data",
    "observations",
    `${partition}.jsonl`,
  );
  const originalSizes = new Map([
    [documentPath, await fileSize(documentPath)],
    [observationPath, await fileSize(observationPath)],
  ]);
  await rename(artefactPath, destination);
  try {
    await appendRecords(
      documentPath,
      [prepared.document],
      dependencies.appendFile,
    );
    await appendRecords(
      observationPath,
      prepared.observations,
      dependencies.appendFile,
    );
  } catch (error) {
    await Promise.all(
      [...originalSizes].map(([path, size]) => restoreFile(path, size)),
    );
    await rename(destination, artefactPath);
    throw error;
  }

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
  append: (path: string, data: string) => Promise<void>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await append(path, `${lines}\n`);
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(
  path: string,
  size: number | undefined,
): Promise<void> {
  if (size === undefined) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    return;
  }
  await truncate(path, size);
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
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
