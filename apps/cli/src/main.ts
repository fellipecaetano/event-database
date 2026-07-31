#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  LogParseError,
  buildProposalCaseFromWorkspace,
  buildReviewCaseFromWorkspace,
  buildReviewQueueFromWorkspace,
  commitIngest,
  createUuidV7Generator,
  createReviewWorkspace,
  documentSourceName,
  hashBytes,
  judgementDraftSchema,
  knownExtractorsFor,
  prepareIngest,
  prepareJudgement,
  prepareProposalDecision,
  prepareReextraction,
  prepareReviewDecision,
  reviewCaseDocuments,
  createProductionFoldRules,
  verifyLog,
  type Document,
  type JudgementDraft,
  type LogRecord,
  type ProposalCase,
  type ReviewCandidate,
  type ReviewCase,
  type ReviewSide,
} from "@event-database/core";

import {
  appendRecords,
  assertPathAbsent,
  fileSize,
  readArtefactHashes,
  readLog,
  restoreFile,
} from "./catalogue-repository.js";

export interface TerminalIo {
  readonly isInteractive: boolean;
  /** Resolves to the typed line, or `undefined` on EOF. */
  readonly question: (prompt: string) => Promise<string | undefined>;
  readonly close: () => void | Promise<void>;
}

interface CliDependencies {
  readonly writeOut: (message: string) => void;
  readonly writeError: (message: string) => void;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly appendFile: (path: string, data: string) => Promise<void>;
  readonly createTerminal: () => TerminalIo;
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
  createTerminal: () => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // One "close" listener for the terminal's whole lifetime. Registering a
    // fresh one per question() would leak a listener every prompt and, over
    // a real multi-case session, trip Node's MaxListenersExceededWarning.
    const closed = new Promise<undefined>((resolve) => {
      rl.once("close", () => {
        resolve(undefined);
      });
    });
    return {
      isInteractive: process.stdin.isTTY && process.stdout.isTTY,
      question: async (prompt) => {
        try {
          return await Promise.race([rl.question(prompt), closed]);
        } catch {
          return undefined;
        }
      },
      close: () => {
        rl.close();
      },
    };
  },
};

const foldRules = createProductionFoldRules();
const knownExtractors = knownExtractorsFor(foldRules);
const yearMonthLength = 7;
const executableArgumentCount = 2;
const reviewOptionArgumentCount = 2;
const reviewUsage =
  "Usage: event-database review [--interactive] [--by person:<id>] [--at <timestamp>] [--repository <path>]";

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
  let interactive = false;
  let by: string | undefined;

  let index = 0;
  while (index < arguments_.length) {
    const option = arguments_[index];
    if (option === "--interactive") {
      interactive = true;
      index += 1;
      continue;
    }
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
    } else if (option === "--by") {
      by = value;
    } else {
      throw new Error(reviewUsage);
    }
    index += reviewOptionArgumentCount;
  }

  if (by !== undefined) {
    if (!interactive) {
      throw new Error("--by is only valid together with --interactive");
    }
    if (!isPersonReviewer(by)) {
      throw new Error(
        `--by must name a person:<id> reviewer, received "${by}"`,
      );
    }
  }

  if (interactive) {
    return runInteractiveReview(dependencies, root, now, by);
  }

  const records = await readLog(root);
  const issues = verifyLog(records, { knownExtractors });
  if (issues.length > 0) {
    throw new Error(
      `cannot build review queue: log has ${String(issues.length)} verification issue(s)`,
    );
  }
  dependencies.writeOut(
    JSON.stringify(
      buildReviewQueueFromWorkspace(
        createReviewWorkspace(records, { now, rules: foldRules }),
      ),
    ),
  );
  return 0;
}

function isPersonReviewer(value: string): boolean {
  const personPrefix = "person:";
  return value.startsWith(personPrefix) && value.length > personPrefix.length;
}

const reviewControls =
  "[s]ame  [d]ifferent  de[f]er  s[k]ip  [v]iew sources  [q]uit";
const proposalControls =
  "[s] confirm  [d] reject  de[f]er  s[k]ip  [v]iew sources  [q]uit";

type ReviewVerdict = "same" | "different" | "deferred";

/** Everything gathered from the reviewer for one case, ready to persist. */
interface CompletedDecision {
  readonly verdict: ReviewVerdict;
  readonly reason?: string;
  readonly survivingEventId?: string;
}

/** `undefined` marks EOF: stop the session without recording anything more. */
type DecisionOutcome = CompletedDecision | "quit" | "skip" | undefined;

interface SessionCounts {
  same: number;
  different: number;
  deferred: number;
  skipped: number;
}

function summaryLine(counts: SessionCounts): string {
  return `same ${String(counts.same)} different ${String(counts.different)} deferred ${String(counts.deferred)} skipped ${String(counts.skipped)}`;
}

async function runInteractiveReview(
  dependencies: CliDependencies,
  root: string,
  queueNow: Date,
  initialBy: string | undefined,
): Promise<number> {
  const terminal = dependencies.createTerminal();
  const counts: SessionCounts = {
    same: 0,
    different: 0,
    deferred: 0,
    skipped: 0,
  };
  try {
    if (!terminal.isInteractive) {
      throw new Error(
        "interactive review requires an interactive terminal; scripted tests must inject one",
      );
    }

    const reviewer = initialBy ?? (await askReviewer(terminal));
    if (reviewer === undefined) {
      // Lost before a session even started: still leave a record of that.
      dependencies.writeOut(summaryLine(counts));
      return 0;
    }

    const nextId = createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    });
    const skippedPairs = new Set<string>();

    try {
      for (;;) {
        const records = await readLog(root);
        const logIssues = verifyLog(records, { knownExtractors });
        if (logIssues.length > 0) {
          throw new Error(
            `cannot build review queue: log has ${String(logIssues.length)} verification issue(s)`,
          );
        }
        const workspace = createReviewWorkspace(records, {
          now: queueNow,
          rules: foldRules,
        });
        const queue = buildReviewQueueFromWorkspace(workspace).filter(
          (candidate) => !skippedPairs.has(pairKey(candidate)),
        );
        const candidate = queue[0];
        if (candidate === undefined) {
          break;
        }

        const reviewCase =
          candidate.kind === "proposal"
            ? buildProposalCaseFromWorkspace(candidate, workspace)
            : buildReviewCaseFromWorkspace(candidate, workspace);
        // Position is honest work done, not queue length: a skip still
        // advances it, so it doesn't read as "the queue is shrinking" while
        // the reviewer is actually making progress through it.
        const worked =
          counts.same + counts.different + counts.deferred + counts.skipped;
        renderCase(dependencies, reviewCase, worked + 1, worked + queue.length);

        const outcome = await runDecisionLoop(
          terminal,
          dependencies,
          reviewCase,
          records,
        );

        if (outcome === "quit" || outcome === undefined) {
          break;
        }
        if (outcome === "skip") {
          skippedPairs.add(pairKey(candidate));
          counts.skipped += 1;
          continue;
        }

        const decidedAt = new Date(dependencies.now()).toISOString();
        const batch =
          reviewCase.kind === "proposal"
            ? prepareProposalDecision(
                {
                  proposal: reviewCase,
                  verdict: outcome.verdict,
                  by: reviewer,
                  ...(outcome.reason === undefined
                    ? {}
                    : { reason: outcome.reason }),
                },
                { at: decidedAt, nextId },
              )
            : prepareReviewDecision(
                {
                  reviewCase,
                  verdict: outcome.verdict,
                  by: reviewer,
                  ...(outcome.reason === undefined
                    ? {}
                    : { reason: outcome.reason }),
                  ...(outcome.survivingEventId === undefined
                    ? {}
                    : { survivingEventId: outcome.survivingEventId }),
                },
                { at: decidedAt, nextId },
              );
        const verificationIssues = verifyLog([...records, ...batch], {
          knownExtractors,
        });
        if (verificationIssues.length > 0) {
          throw new Error(
            `cannot record decision: ${verificationIssues
              .map((issue) => `${issue.code}: ${issue.message}`)
              .join("; ")}`,
          );
        }
        const partition = decidedAt.slice(0, yearMonthLength);
        await appendRecords(
          join(root, "data", "judgements", `${partition}.jsonl`),
          batch,
          dependencies.appendFile,
        );
        counts[outcome.verdict] += 1;
        if (candidate.kind !== "proposal") {
          // Withheld until now so the pairing reasons cannot steer the
          // decision. A proposal has nothing left to reveal: what raised it
          // was on screen from the start.
          dependencies.writeOut(
            `Matched because: ${candidate.reasons.join(", ")}`,
          );
        }
      }
    } catch (error) {
      // A reviewer who loses a session mid-way most needs to know what
      // actually got persisted before it failed.
      dependencies.writeOut(summaryLine(counts));
      throw error;
    }

    dependencies.writeOut(summaryLine(counts));
    return 0;
  } finally {
    await terminal.close();
  }
}

function pairKey(candidate: ReviewCandidate): string {
  return candidate.kind === "proposal"
    ? `proposal ${candidate.matchId}`
    : candidate.eventIds.toSorted().join("\u0000");
}

async function askReviewer(terminal: TerminalIo): Promise<string | undefined> {
  for (;;) {
    const answer = await terminal.question("Reviewer (person:<id>): ");
    if (answer === undefined) {
      return undefined;
    }
    const trimmed = answer.trim();
    if (isPersonReviewer(trimmed)) {
      return trimmed;
    }
  }
}

async function runDecisionLoop(
  terminal: TerminalIo,
  dependencies: CliDependencies,
  reviewCase: ReviewCase | ProposalCase,
  records: readonly LogRecord[],
): Promise<DecisionOutcome> {
  for (;;) {
    const answer = await terminal.question("Decision: ");
    if (answer === undefined) {
      return undefined;
    }
    const control = answer.trim().toLowerCase();
    if (control === "v") {
      for (const document of caseDocuments(reviewCase, records)) {
        dependencies.writeOut(
          `${documentSourceName(document)}: ${document.text}`,
        );
      }
      continue;
    }
    if (control === "q") {
      return "quit";
    }
    if (control === "k") {
      return "skip";
    }
    if (control !== "s" && control !== "d" && control !== "f") {
      continue;
    }

    const verdict: ReviewVerdict =
      control === "s" ? "same" : control === "d" ? "different" : "deferred";
    const reasonAnswer = await terminal.question("Reason (optional): ");
    if (reasonAnswer === undefined) {
      return undefined;
    }
    const trimmedReason = reasonAnswer.trim();
    const reason = trimmedReason.length > 0 ? trimmedReason : undefined;

    // A proposal already names its direction: confirming it moves the subject
    // onto the entity it was raised against, so there is no survivor to pick.
    if (verdict !== "same" || reviewCase.kind === "proposal") {
      return { verdict, ...(reason === undefined ? {} : { reason }) };
    }

    const survivingEventId = await askSurvivor(terminal, reviewCase);
    if (survivingEventId === undefined) {
      return undefined;
    }
    return {
      verdict,
      survivingEventId,
      ...(reason === undefined ? {} : { reason }),
    };
  }
}

async function askSurvivor(
  terminal: TerminalIo,
  reviewCase: ReviewCase,
): Promise<string | undefined> {
  for (;;) {
    // A marked as suggested, but an explicit "a"/"b" keystroke is still
    // required — an empty answer must never be silently taken as A.
    const answer = await terminal.question(
      `Surviving Event — [a] event:${reviewCase.a.eventId} (suggested) or [b] event:${reviewCase.b.eventId}: `,
    );
    if (answer === undefined) {
      return undefined;
    }
    const choice = answer.trim().toLowerCase();
    if (choice === "a") {
      return reviewCase.a.eventId;
    }
    if (choice === "b") {
      return reviewCase.b.eventId;
    }
  }
}

function caseDocuments(
  reviewCase: ReviewCase | ProposalCase,
  records: readonly LogRecord[],
): readonly Document[] {
  if (reviewCase.kind !== "proposal") {
    return reviewCaseDocuments(reviewCase, records);
  }
  const documents = new Map(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => [document.id, document]),
  );
  return [...new Set(reviewCase.evidence.map((item) => item.documentId))]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((id) => {
      const document = documents.get(id);
      return document === undefined ? [] : [document];
    });
}

function renderCase(
  dependencies: CliDependencies,
  reviewCase: ReviewCase | ProposalCase,
  index: number,
  total: number,
): void {
  if (reviewCase.kind === "proposal") {
    renderProposal(dependencies, reviewCase, index, total);
    return;
  }
  dependencies.writeOut(
    `Case ${String(index)} of ${String(total)} — ${reviewCase.eventDate}`,
  );
  renderSide(dependencies, reviewCase.a);
  renderSide(dependencies, reviewCase.b);
  dependencies.writeOut(reviewControls);
}

function renderProposal(
  dependencies: CliDependencies,
  proposal: ProposalCase,
  index: number,
  total: number,
): void {
  // The reason is the machine's own, and it is shown: unlike an Event pair,
  // a proposal is unintelligible without knowing what raised it.
  dependencies.writeOut(
    `Case ${String(index)} of ${String(total)} — proposal raised by ${proposal.raisedBy}`,
  );
  if (proposal.reason !== undefined) {
    dependencies.writeOut(`  ${proposal.reason}`);
  }
  renderProposalSide(dependencies, "A", proposal.from, "would be merged away");
  renderProposalSide(dependencies, "B", proposal.to, "would survive");
  if (proposal.evidence.length > 0) {
    dependencies.writeOut("  Sources:");
    for (const evidence of proposal.evidence) {
      dependencies.writeOut(
        `    ${evidence.sourceName} · ${evidence.timeKind} ${evidence.time}`,
      );
      if (evidence.spans.length > 0) {
        dependencies.writeOut(`      "${evidence.spans.join('" · "')}"`);
      }
    }
  }
  dependencies.writeOut(proposalControls);
}

function renderProposalSide(
  dependencies: CliDependencies,
  label: "A" | "B",
  side: ProposalCase["from"],
  role: string,
): void {
  const count = side.observationIds.length;
  dependencies.writeOut(
    `${label} — ${side.id}${side.label === undefined ? "" : ` (${side.label})`} — ${role}`,
  );
  dependencies.writeOut(
    `  ${String(count)} ${count === 1 ? "Observation" : "Observations"}`,
  );
}

function renderSide(dependencies: CliDependencies, side: ReviewSide): void {
  // `date` sits ahead of `start`: `compareEvents` admits pairs up to a day
  // apart, and the header only ever carries the earlier of the two dates,
  // so each side must assert its own or a night-apart pair reads as one.
  const summary = [
    side.title,
    side.venueName,
    side.date,
    side.start,
    side.showtime,
    side.status,
    side.ticketSignal,
  ].filter((part): part is string => part !== undefined);
  dependencies.writeOut(
    `${side.label} — event:${side.eventId}${
      summary.length > 0 ? ` (${summary.join(" · ")})` : ""
    }`,
  );
  if (side.lineup !== undefined && side.lineup.length > 0) {
    dependencies.writeOut(`  Lineup: ${side.lineup.join(", ")}`);
  }
  const observationCount = side.observationIds.length;
  dependencies.writeOut(
    `  ${String(observationCount)} ${observationCount === 1 ? "Observation" : "Observations"}`,
  );
  if (side.evidence.length > 0) {
    dependencies.writeOut("  Sources:");
    for (const evidence of side.evidence) {
      dependencies.writeOut(
        `    ${evidence.sourceName} · ${evidence.timeKind} ${evidence.time}`,
      );
      if (evidence.spans.length > 0) {
        dependencies.writeOut(`      "${evidence.spans.join('" · "')}"`);
      }
    }
  }
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
  await commitIngest({
    moveArtefact: async () => rename(artefactPath, destination),
    appendDocument: async () =>
      appendRecords(documentPath, [prepared.document], dependencies.appendFile),
    appendObservations: async () =>
      appendRecords(
        observationPath,
        prepared.observations,
        dependencies.appendFile,
      ),
    rollbackAppends: async () => {
      await Promise.all(
        [...originalSizes].map(([path, size]) => restoreFile(path, size)),
      );
    },
    restoreArtefact: async () => rename(destination, artefactPath),
  });

  const noun =
    prepared.observations.length === 1 ? "Observation" : "Observations";
  dependencies.writeOut(
    `Ingested Document ${prepared.document.id} with ${String(prepared.observations.length)} ${noun}.`,
  );
  return 0;
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

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  process.exitCode = await runCli(process.argv.slice(executableArgumentCount));
}

export { LogParseError };
