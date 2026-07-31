import {
  fold,
  type FoldOptions,
  type ProjectedEntity,
  type ProjectedFact,
} from "./fold.js";
import { parseEntityReference } from "./entity-reference.js";
import { compareJudgementPrecedence } from "./judgement-precedence.js";
import type { LogRecord } from "./records.js";

const millisecondsPerDay = 86_400_000;
const isoDateLength = 10;
type MatchRecord = Extract<LogRecord, { type: "match" }>;
type ObservationMatch = MatchRecord & {
  readonly subject: Extract<MatchRecord["subject"], { kind: "observation" }>;
};

export type ReviewReason = "same-venue" | "shared-act";

export interface EventPairCandidate {
  readonly kind: "event-pair";
  readonly eventIds: readonly [string, string];
  readonly eventDate: string;
  readonly impact: number;
  readonly reasons: ReviewReason[];
}

/**
 * A Match the system raised but nobody vouched for. It carries no authority —
 * neither the Fold nor `isSuppressed` reads it — so it stays in the band until
 * a person answers it with a settled Match at the same subject and entity.
 */
export interface ProposalCandidate {
  readonly kind: "proposal";
  readonly matchId: string;
  readonly subject: MatchRecord["subject"];
  readonly entity: string;
  readonly verdict: MatchRecord["verdict"];
  readonly raisedBy: string;
  readonly at: string;
  readonly reason?: string;
}

export type ReviewCandidate = EventPairCandidate | ProposalCandidate;

export function buildReviewQueue(
  records: readonly LogRecord[],
  options: FoldOptions,
): ReviewCandidate[] {
  return [
    ...buildProposalQueue(records),
    ...buildEventPairQueue(records, options),
  ];
}

/** Stable key for the question a Match answers: this subject, this entity. */
function matchKey(subject: MatchRecord["subject"], entity: string): string {
  const subjectKey =
    subject.kind === "observation"
      ? `observation:${subject.id}`
      : `venue-name:${subject.value}`;
  return `${subjectKey}\u0000${entity}`;
}

function buildProposalQueue(
  records: readonly LogRecord[],
): ProposalCandidate[] {
  const matches = records.filter(
    (record): record is MatchRecord => record.type === "match",
  );
  const settled = new Set(
    matches
      .filter((match) => match.proposed !== true)
      .map((match) => matchKey(match.subject, match.entity)),
  );

  // One question, one queue entry: a key raised twice keeps its strongest
  // proposal rather than asking the reviewer the same thing twice.
  const strongest = new Map<string, MatchRecord>();
  for (const match of matches) {
    if (match.proposed !== true) {
      continue;
    }
    const key = matchKey(match.subject, match.entity);
    if (settled.has(key)) {
      continue;
    }
    const existing = strongest.get(key);
    if (existing === undefined || compareDecisions(existing, match) < 0) {
      strongest.set(key, match);
    }
  }

  return [...strongest.values()]
    .map((match) => ({
      kind: "proposal" as const,
      matchId: match.id,
      subject: match.subject,
      entity: match.entity,
      verdict: match.verdict,
      raisedBy: match.by,
      at: match.at,
      ...(match.reason === undefined ? {} : { reason: match.reason }),
    }))
    .toSorted(
      (left, right) =>
        left.at.localeCompare(right.at) ||
        left.matchId.localeCompare(right.matchId),
    );
}

function buildEventPairQueue(
  records: readonly LogRecord[],
  options: FoldOptions,
): EventPairCandidate[] {
  const catalogue = fold(records, options);
  const candidates: EventPairCandidate[] = [];

  for (let leftIndex = 0; leftIndex < catalogue.events.length; leftIndex += 1) {
    const left = catalogue.events[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < catalogue.events.length;
      rightIndex += 1
    ) {
      const right = catalogue.events[rightIndex];
      if (right === undefined) {
        continue;
      }
      const candidate = compareEvents(left, right);
      if (
        candidate !== undefined &&
        !isSuppressed(candidate, left, right, records)
      ) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.toSorted(
    (left, right) =>
      left.eventDate.localeCompare(right.eventDate) ||
      right.impact - left.impact ||
      left.eventIds[0].localeCompare(right.eventIds[0]) ||
      left.eventIds[1].localeCompare(right.eventIds[1]),
  );
}

function compareEvents(
  left: ProjectedEntity,
  right: ProjectedEntity,
): EventPairCandidate | undefined {
  const leftDate = eventDate(left);
  const rightDate = eventDate(right);
  if (
    leftDate === undefined ||
    rightDate === undefined ||
    dayDistance(leftDate, rightDate) > 1
  ) {
    return undefined;
  }

  const reasons: ReviewReason[] = [];
  const leftVenue = stringFact(left.facts["venue_name"]);
  const rightVenue = stringFact(right.facts["venue_name"]);
  if (
    leftVenue !== undefined &&
    rightVenue !== undefined &&
    normalizeVenueName(leftVenue) === normalizeVenueName(rightVenue)
  ) {
    reasons.push("same-venue");
  }

  const leftActs = eventActs(left);
  const rightActs = eventActs(right);
  if ([...leftActs].some((act) => rightActs.has(act))) {
    reasons.push("shared-act");
  }

  if (reasons.length === 0) {
    return undefined;
  }

  const eventIds: readonly [string, string] =
    left.id.localeCompare(right.id) <= 0
      ? [left.id, right.id]
      : [right.id, left.id];
  return {
    kind: "event-pair",
    eventIds,
    eventDate: leftDate.localeCompare(rightDate) <= 0 ? leftDate : rightDate,
    impact: left.observationIds.length + right.observationIds.length,
    reasons,
  };
}

function eventDate(event: ProjectedEntity): string | undefined {
  const date = stringFact(event.facts["date"]);
  if (date !== undefined) {
    return date;
  }
  return stringFact(event.facts["start"])?.slice(0, isoDateLength);
}

function stringFact(fact: ProjectedFact | undefined): string | undefined {
  return fact?.state === "known" && typeof fact.value === "string"
    ? fact.value
    : undefined;
}

function dayDistance(left: string, right: string): number {
  return (
    Math.abs(
      Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`),
    ) / millisecondsPerDay
  );
}

export function normalizeVenueName(value: string): string {
  return normalizeText(value.replace(/\s*\([^)]*\)\s*$/u, ""));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function eventActs(event: ProjectedEntity): Set<string> {
  const acts = new Set<string>();
  const lineup = event.facts["lineup"];
  if (lineup?.state === "known" && Array.isArray(lineup.value)) {
    for (const value of lineup.value) {
      if (typeof value === "string") {
        acts.add(normalizeText(value));
      }
    }
  }
  const title = stringFact(event.facts["title"]);
  if (title !== undefined) {
    acts.add(normalizeText(title));
  }
  return acts;
}

function isSuppressed(
  candidate: EventPairCandidate,
  left: ProjectedEntity,
  right: ProjectedEntity,
  records: readonly LogRecord[],
): boolean {
  const observationToEvent = new Map<string, string>();
  for (const event of [left, right]) {
    for (const observationId of event.observationIds) {
      observationToEvent.set(observationId, event.id);
    }
  }

  const decisions = records
    .filter((record): record is MatchRecord => record.type === "match")
    .filter(
      (record): record is ObservationMatch =>
        record.subject.kind === "observation" && record.proposed !== true,
    )
    .filter((match) => {
      const subjectEvent = observationToEvent.get(match.subject.id);
      const target = parseEntityReference(match.entity);
      if (subjectEvent === undefined || target.kind !== "event") {
        return false;
      }
      return samePair(candidate.eventIds, [subjectEvent, target.id]);
    })
    .toSorted(compareDecisions);
  const decision = decisions.at(-1);
  if (decision?.verdict === "different") {
    return true;
  }
  if (decision?.verdict !== "deferred") {
    return false;
  }

  const newestEvidence = records
    .filter(
      (record) =>
        record.type === "observation" &&
        (left.observationIds.includes(record.id) ||
          right.observationIds.includes(record.id)),
    )
    .reduce(
      (latest, observation) =>
        observation.at.localeCompare(latest) > 0 ? observation.at : latest,
      "",
    );
  return newestEvidence.localeCompare(decision.at) <= 0;
}

function samePair(
  left: readonly [string, string],
  right: readonly [string, string],
): boolean {
  const orderedRight = right.toSorted();
  return left[0] === orderedRight[0] && left[1] === orderedRight[1];
}

function compareDecisions(left: MatchRecord, right: MatchRecord): number {
  return compareJudgementPrecedence(left, right);
}
