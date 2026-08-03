#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  LogParseError,
  buildProposalCaseFromWorkspace,
  buildReviewCaseFromWorkspace,
  buildVenueReviewCaseFromWorkspace,
  buildReviewQueueFromWorkspace,
  commitIngest,
  createUuidV7Generator,
  createReviewWorkspace,
  documentSourceName,
  judgementDraftSchema,
  knownExtractorsFor,
  prepareIngest,
  prepareJudgement,
  prepareProposalDecision,
  prepareReextraction,
  prepareReviewDecision,
  prepareVenueReviewDecision,
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
  type VenueReviewCase,
  type VenueReviewSide,
} from "@event-database/core";

import { LocalCatalogueData } from "./catalogue-repository.js";
import { CatalogueDataLayout } from "./catalogue-data-layout.js";
import {
  pullInbox,
  s3InboxFromEnvironment,
  type RemoteInbox,
} from "./s3-inbox.js";

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
  readonly appendFile?: (path: string, data: string) => Promise<void>;
  readonly createRemoteInbox: () => RemoteInbox;
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
  createRemoteInbox: s3InboxFromEnvironment,
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
const executableArgumentCount = 2;
const reviewOptionArgumentCount = 2;
const reviewUsage =
  "Usage: event-database review [--interactive] [--by person:<id>] [--at <timestamp>] [--repository <path>]";

function createCatalogueData(
  root: string,
  dependencies: CliDependencies,
): LocalCatalogueData {
  const layout = new CatalogueDataLayout(root);
  return dependencies.appendFile === undefined
    ? new LocalCatalogueData(layout)
    : new LocalCatalogueData(layout, { appendFile: dependencies.appendFile });
}

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
    if (command === "inbox") {
      return await runInbox(arguments_.slice(1), dependencies);
    }
    dependencies.writeError(
      "Usage: event-database <inbox|ingest|judge|pending|reextract|review|verify> [arguments]",
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
  const data = createCatalogueData(root, dependencies);
  const existingRecords = await data.readLog();
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
  await data.append(observations);
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
  const data = createCatalogueData(root, dependencies);
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
  const issues = verifyLog([...(await data.readLog()), judgement], {
    knownExtractors,
  });
  if (issues.length > 0) {
    throw new Error(
      `cannot record Judgement: ${issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  await data.append([judgement]);
  dependencies.writeOut(`Recorded ${judgement.type} ${judgement.id}.`);
  return 0;
}

async function runPending(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [root = process.cwd()] = arguments_;
  const data = createCatalogueData(root, dependencies);
  const records = await data.readLog();
  const heldHashes = new Set(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => document.artefact_hash),
  );
  for (const pending of await data.pendingArtefacts(heldHashes)) {
    dependencies.writeOut(pending.repositoryRelativePath);
  }
  return 0;
}

async function runInbox(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const [action, root = process.cwd()] = arguments_;
  if (action !== "pull") {
    dependencies.writeError("Usage: event-database inbox pull [repository]");
    return 1;
  }
  const result = await pullInbox(
    dependencies.createRemoteInbox(),
    createCatalogueData(root, dependencies),
  );
  dependencies.writeOut(
    `Pulled ${String(result.pulled)} files; ${String(result.alreadyPresent)} already present.`,
  );
  if (result.conflicts > 0) {
    dependencies.writeError(
      `${String(result.conflicts)} remote inbox files conflict with local bytes.`,
    );
    return 1;
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

  const data = createCatalogueData(root, dependencies);

  if (interactive) {
    return runInteractiveReview(dependencies, data, now, by);
  }

  const records = await data.readLog();
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
  readonly survivingVenueId?: string;
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
  data: LocalCatalogueData,
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
        const records = await data.readLog();
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
            : candidate.kind === "venue-pair"
              ? buildVenueReviewCaseFromWorkspace(candidate, workspace)
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
            : reviewCase.kind === "venue-pair"
              ? prepareVenueReviewDecision(
                  {
                    reviewCase,
                    verdict: outcome.verdict,
                    by: reviewer,
                    ...(outcome.reason === undefined
                      ? {}
                      : { reason: outcome.reason }),
                    ...(outcome.survivingVenueId === undefined
                      ? {}
                      : { survivingVenueId: outcome.survivingVenueId }),
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
        await data.append(batch);
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
    : candidate.kind === "venue-pair"
      ? `venue ${candidate.venueIds.toSorted().join("\u0000")}`
      : `event ${candidate.eventIds.toSorted().join("\u0000")}`;
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
  reviewCase: ReviewCase | VenueReviewCase | ProposalCase,
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

    const survivingEntityId = await askSurvivor(terminal, reviewCase);
    if (survivingEntityId === undefined) {
      return undefined;
    }
    return reviewCase.kind === "venue-pair"
      ? {
          verdict,
          survivingVenueId: survivingEntityId,
          ...(reason === undefined ? {} : { reason }),
        }
      : {
          verdict,
          survivingEventId: survivingEntityId,
          ...(reason === undefined ? {} : { reason }),
        };
  }
}

async function askSurvivor(
  terminal: TerminalIo,
  reviewCase: ReviewCase | VenueReviewCase,
): Promise<string | undefined> {
  const entityName = reviewCase.kind === "venue-pair" ? "Venue" : "Event";
  const aId =
    reviewCase.kind === "venue-pair"
      ? reviewCase.a.venueId
      : reviewCase.a.eventId;
  const bId =
    reviewCase.kind === "venue-pair"
      ? reviewCase.b.venueId
      : reviewCase.b.eventId;
  for (;;) {
    // A marked as suggested, but an explicit "a"/"b" keystroke is still
    // required — an empty answer must never be silently taken as A.
    const answer = await terminal.question(
      `Surviving ${entityName} — [a] ${entityName.toLowerCase()}:${aId} (suggested) or [b] ${entityName.toLowerCase()}:${bId}: `,
    );
    if (answer === undefined) {
      return undefined;
    }
    const choice = answer.trim().toLowerCase();
    if (choice === "a") {
      return aId;
    }
    if (choice === "b") {
      return bId;
    }
  }
}

function caseDocuments(
  reviewCase: ReviewCase | VenueReviewCase | ProposalCase,
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
  reviewCase: ReviewCase | VenueReviewCase | ProposalCase,
  index: number,
  total: number,
): void {
  if (reviewCase.kind === "proposal") {
    renderProposal(dependencies, reviewCase, index, total);
    return;
  }
  if (reviewCase.kind === "venue-pair") {
    dependencies.writeOut(`Case ${String(index)} of ${String(total)} — Venue`);
    renderVenueSide(dependencies, reviewCase.a);
    renderVenueSide(dependencies, reviewCase.b);
    dependencies.writeOut(reviewControls);
    return;
  }
  dependencies.writeOut(
    `Case ${String(index)} of ${String(total)} — ${reviewCase.eventDate}`,
  );
  renderSide(dependencies, reviewCase.a);
  renderSide(dependencies, reviewCase.b);
  dependencies.writeOut(reviewControls);
}

function renderVenueSide(
  dependencies: CliDependencies,
  side: VenueReviewSide,
): void {
  const summary = [
    side.venueName,
    side.address,
    side.neighbourhood,
    side.city,
  ].filter((part): part is string => part !== undefined);
  dependencies.writeOut(
    `${side.label} — venue:${side.venueId}${summary.length > 0 ? ` (${summary.join(" · ")})` : ""}`,
  );
  dependencies.writeOut(
    `  ${String(side.observationIds.length)} ${side.observationIds.length === 1 ? "Observation" : "Observations"}`,
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
  const data = createCatalogueData(root, dependencies);
  const records = await data.readLog();
  const artefactHashes = await data.artefactHashes(
    records.filter((record): record is Document => record.type === "document"),
  );
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

  const data = createCatalogueData(root, dependencies);
  const inspectedArtefact = await data.inspectInboxArtefact(artefactPath);
  const existingRecords = await data.readLog();

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
  const prepared = prepareIngest(draftValue, {
    at,
    artefact: inspectedArtefact.reference.value,
    artefactHash: inspectedArtefact.hash,
    existingRecords,
    extractorTrust: foldRules.extractorTrust,
    nextId: createUuidV7Generator({
      now: dependencies.now,
      randomBytes: dependencies.randomBytes,
    }),
  });

  await commitIngest(
    await data.beginIngest({
      sourcePath: inspectedArtefact.path,
      expectedHash: inspectedArtefact.hash,
      document: prepared.document,
      observations: prepared.observations,
    }),
  );

  const noun =
    prepared.observations.length === 1 ? "Observation" : "Observations";
  dependencies.writeOut(
    `Ingested Document ${prepared.document.id} with ${String(prepared.observations.length)} ${noun}.`,
  );
  return 0;
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  process.exitCode = await runCli(process.argv.slice(executableArgumentCount));
}

export { LogParseError };
