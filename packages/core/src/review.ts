import {
  fold,
  selectReadings,
  type FoldOptions,
  type FoldRules,
  type ProjectedEntity,
  type ProjectedFact,
} from "./fold.js";
import type { ReviewCandidate } from "./matching.js";
import {
  documentSourceName,
  type Claim,
  type Document,
  type LogRecord,
  type Observation,
} from "./records.js";

export interface ReviewEvidence {
  readonly observationId: string;
  readonly documentId: string;
  readonly sourceName: string;
  /** Publication time when the Document has one, otherwise retrieval time. */
  readonly time: string;
  readonly timeKind: "published" | "retrieved";
  /** Claim Spans behind the compared facts, deduplicated, deterministic order. */
  readonly spans: readonly string[];
}

export interface ReviewSide {
  readonly label: "A" | "B";
  readonly eventId: string;
  readonly observationIds: readonly string[];
  readonly title?: string;
  readonly lineup?: readonly string[];
  readonly date?: string;
  readonly start?: string;
  readonly showtime?: string;
  readonly venueName?: string;
  readonly status?: string;
  /** Human-facing ticket signal; absent when unknown. */
  readonly ticketSignal?: string;
  readonly evidence: readonly ReviewEvidence[];
}

export interface ReviewCase {
  readonly eventDate: string;
  readonly a: ReviewSide;
  readonly b: ReviewSide;
}

/**
 * Fold-settled fact fields a reviewer is shown. Excludes fields (genre_words,
 * price_from, ticket_url, ...) that are not compared on the review screen, so
 * their Spans never leak into evidence quotes.
 */
const comparedEventFields = [
  "title",
  "lineup",
  "date",
  "start",
  "showtime",
  "venue_name",
  "status",
  "tickets_exist",
  "tickets_at_door",
] as const;

export function buildReviewCase(
  candidate: ReviewCandidate,
  records: readonly LogRecord[],
  options: FoldOptions,
): ReviewCase {
  const catalogue = fold(records, options);
  const [aId, bId] = candidate.eventIds;
  const a = findEvent(catalogue.events, aId);
  const b = findEvent(catalogue.events, bId);
  const observationsById = new Map(
    records
      .filter((record): record is Observation => record.type === "observation")
      .map((observation) => [observation.id, observation]),
  );
  const documents = new Map(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => [document.id, document]),
  );

  return {
    eventDate: candidate.eventDate,
    a: buildSide("A", a, observationsById, documents, options.rules),
    b: buildSide("B", b, observationsById, documents, options.rules),
  };
}

/** Full retained Documents behind a case, deterministic order, deduplicated. */
export function reviewCaseDocuments(
  reviewCase: ReviewCase,
  records: readonly LogRecord[],
): readonly Document[] {
  const documents = new Map(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => [document.id, document]),
  );
  const ids = new Set([
    ...reviewCase.a.evidence.map((evidence) => evidence.documentId),
    ...reviewCase.b.evidence.map((evidence) => evidence.documentId),
  ]);
  return [...ids]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const document = documents.get(id);
      if (document === undefined) {
        throw new Error(`reviewCaseDocuments: missing Document ${id}`);
      }
      return document;
    });
}

function findEvent(
  events: readonly ProjectedEntity[],
  eventId: string,
): ProjectedEntity {
  const event = events.find((candidate) => candidate.id === eventId);
  if (event === undefined) {
    throw new Error(`buildReviewCase: missing Event ${eventId}`);
  }
  return event;
}

function buildSide(
  label: "A" | "B",
  entity: ProjectedEntity,
  observationsById: ReadonlyMap<string, Observation>,
  documents: ReadonlyMap<string, Document>,
  rules: FoldRules,
): ReviewSide {
  const facts = entity.facts;
  const title = factString(facts["title"]);
  const lineup = factStringArray(facts["lineup"]);
  const date = factString(facts["date"]);
  const start = factString(facts["start"]);
  const showtime = factString(facts["showtime"]);
  const venueName = factString(facts["venue_name"]);
  const status = factString(facts["status"]);
  const signal = ticketSignal(facts);

  // `observationIds` keeps every grouped Observation — a merge must re-point
  // all of them. Evidence narrows through the same lineage selection the
  // Fold applies, so a superseded reading never renders as if still live.
  const groupedObservations = entity.observationIds.map((observationId) =>
    lookUpObservation(observationId, observationsById),
  );
  const evidenceObservations = selectReadings(
    groupedObservations,
    observationsById,
    rules,
  ).toSorted((left, right) => left.id.localeCompare(right.id));

  return {
    label,
    eventId: entity.id,
    observationIds: entity.observationIds,
    ...(title === undefined ? {} : { title }),
    ...(lineup === undefined ? {} : { lineup }),
    ...(date === undefined ? {} : { date }),
    ...(start === undefined ? {} : { start }),
    ...(showtime === undefined ? {} : { showtime }),
    ...(venueName === undefined ? {} : { venueName }),
    ...(status === undefined ? {} : { status }),
    ...(signal === undefined ? {} : { ticketSignal: signal }),
    evidence: evidenceObservations.map((observation) =>
      buildEvidence(observation, documents),
    ),
  };
}

function lookUpObservation(
  observationId: string,
  observationsById: ReadonlyMap<string, Observation>,
): Observation {
  const observation = observationsById.get(observationId);
  if (observation === undefined) {
    throw new Error(`buildReviewCase: missing Observation ${observationId}`);
  }
  return observation;
}

function buildEvidence(
  observation: Observation,
  documents: ReadonlyMap<string, Document>,
): ReviewEvidence {
  const document = documents.get(observation.document);
  if (document === undefined) {
    throw new Error(
      `buildReviewCase: missing Document ${observation.document}`,
    );
  }
  const publishedAt =
    document.v === 1 ? document.published_at : document.published_at?.value;
  const timeKind: "published" | "retrieved" =
    publishedAt === undefined ? "retrieved" : "published";

  return {
    observationId: observation.id,
    documentId: document.id,
    sourceName: documentSourceName(document),
    time: publishedAt ?? document.retrieved_at,
    timeKind,
    spans: comparedSpans(observation.claims),
  };
}

function comparedSpans(
  claims: Readonly<Record<string, Claim | undefined>>,
): string[] {
  const spans = new Set<string>();
  for (const field of comparedEventFields) {
    const claim = claims[field];
    if (claim === undefined) {
      continue;
    }
    for (const span of claim.spans) {
      spans.add(span);
    }
  }
  return [...spans].sort((left, right) => left.localeCompare(right));
}

function factString(fact: ProjectedFact | undefined): string | undefined {
  return fact?.state === "known" && typeof fact.value === "string"
    ? fact.value
    : undefined;
}

function factStringArray(
  fact: ProjectedFact | undefined,
): readonly string[] | undefined {
  if (fact?.state !== "known" || !Array.isArray(fact.value)) {
    return undefined;
  }
  return fact.value.filter(
    (value): value is string => typeof value === "string",
  );
}

function factBoolean(fact: ProjectedFact | undefined): boolean | undefined {
  return fact?.state === "known" && typeof fact.value === "boolean"
    ? fact.value
    : undefined;
}

function ticketSignal(
  facts: Readonly<Record<string, ProjectedFact>>,
): string | undefined {
  if (factBoolean(facts["tickets_at_door"]) === true) {
    return "tickets at door";
  }
  if (factBoolean(facts["tickets_exist"]) === true) {
    return "tickets";
  }
  return undefined;
}
