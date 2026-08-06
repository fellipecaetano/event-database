import {
  type FoldOptions,
  type FoldRules,
  type ProjectedEntity,
  type ProjectedFact,
} from "./fold.js";
import {
  createReviewWorkspace,
  type ReviewWorkspace,
} from "./review-workspace.js";
import { selectReadings } from "./reading-selection.js";
import { parseEntityReference } from "./entity-reference.js";
import {
  normalizeVenueName,
  type EventPairCandidate,
  type ProposalCandidate,
  type VenuePairCandidate,
} from "./matching.js";
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
  /** The Venue this Event's name resolves to, when the Fold holds one. */
  readonly venue?: {
    readonly id: string;
    readonly observationIds: readonly string[];
  };
  readonly status?: string;
  /** Human-facing ticket signal; absent when unknown. */
  readonly ticketSignal?: string;
  readonly evidence: readonly ReviewEvidence[];
}

export interface ReviewCase {
  readonly kind: "event-pair";
  readonly eventDate: string;
  readonly a: ReviewSide;
  readonly b: ReviewSide;
}

export interface VenueReviewSide {
  readonly label: "A" | "B";
  readonly venueId: string;
  readonly observationIds: readonly string[];
  readonly venueName?: string;
  readonly city?: string;
  readonly address?: string;
  readonly neighbourhood?: string;
  readonly evidence: readonly ReviewEvidence[];
}

export interface VenueReviewCase {
  readonly kind: "venue-pair";
  readonly a: VenueReviewSide;
  readonly b: VenueReviewSide;
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

/** What a Venue is judged on. An Event's fields say nothing about a room. */
const comparedVenueFields = [
  "venue_name",
  "address",
  "city",
  "neighbourhood",
] as const;

/** One side of a proposal: an entity, the name it goes by, and its evidence. */
export interface ProposalSide {
  readonly id: string;
  readonly label?: string;
  readonly observationIds: readonly string[];
}

export interface ProposalCase {
  readonly kind: "proposal";
  readonly matchId: string;
  readonly entity: string;
  /** The question this proposal asks, and the key an answer must settle. */
  readonly subject: ProposalCandidate["subject"];
  readonly raisedBy: string;
  readonly reason?: string;
  /** Where the subject sits today. */
  readonly from: ProposalSide;
  /** Where confirming the proposal would move it. */
  readonly to: ProposalSide;
  readonly evidence: readonly ReviewEvidence[];
}

/**
 * Renders a standing proposal as two sides, the way an Event pair renders, so
 * confirming one is the same act of judgement: look at both, decide, record.
 */
export function buildProposalCase(
  candidate: ProposalCandidate,
  records: readonly LogRecord[],
  options: FoldOptions,
): ProposalCase {
  return buildProposalCaseFromWorkspace(
    candidate,
    createReviewWorkspace(records, options),
  );
}

export function buildProposalCaseFromWorkspace(
  candidate: ProposalCandidate,
  workspace: ReviewWorkspace,
): ProposalCase {
  const { catalogue } = workspace;
  const target = parseEntityReference(candidate.entity);
  const pool =
    target.kind === "venue"
      ? catalogue.venues
      : (catalogue.events as readonly ProjectedEntity[]);
  const to = pool.find((entity) => entity.id === target.id);
  if (to === undefined) {
    throw new Error(`buildProposalCase: missing ${candidate.entity}`);
  }

  if (candidate.subject.kind !== "observation") {
    // A venue-name subject names a string, not a record: there is no Document
    // behind it and nothing to move but the name itself.
    return {
      kind: "proposal",
      matchId: candidate.matchId,
      entity: candidate.entity,
      subject: candidate.subject,
      raisedBy: candidate.raisedBy,
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
      from: {
        id: candidate.subject.value,
        label: candidate.subject.value,
        observationIds: [],
      },
      to: proposalSide(to),
      evidence: [],
    };
  }

  const subjectId = candidate.subject.id;
  const from = pool.find((entity) => entity.observationIds.includes(subjectId));
  if (from === undefined) {
    throw new Error(
      `buildProposalCase: missing entity holding Observation ${subjectId}`,
    );
  }

  const observation = workspace.index.observationsById.get(subjectId);
  if (observation === undefined) {
    throw new Error(`buildProposalCase: missing Observation ${subjectId}`);
  }

  return {
    kind: "proposal",
    matchId: candidate.matchId,
    entity: candidate.entity,
    subject: candidate.subject,
    raisedBy: candidate.raisedBy,
    ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
    from: proposalSide(from),
    to: proposalSide(to),
    evidence: [
      buildEvidence(
        observation,
        workspace.index.documentsById,
        target.kind === "venue" ? comparedVenueFields : comparedEventFields,
      ),
    ],
  };
}

/**
 * Matches an Event's Venue name to a Venue the Fold holds, under the same
 * normalisation the matcher blocks on, so "NIÁ" and "Niá" find one another.
 */
function resolveVenue(
  venueName: string | undefined,
  venues: readonly ProjectedEntity[],
): ReviewSide["venue"] {
  if (venueName === undefined) {
    return undefined;
  }
  const wanted = normalizeVenueName(venueName);
  const venue = venues.find((candidate) => {
    const name = factString(candidate.facts["venue_name"]);
    return name !== undefined && normalizeVenueName(name) === wanted;
  });
  return venue === undefined
    ? undefined
    : { id: venue.id, observationIds: venue.observationIds };
}

function proposalSide(entity: ProjectedEntity): ProposalSide {
  const label =
    factString(entity.facts["venue_name"]) ?? factString(entity.facts["title"]);
  return {
    id: entity.id,
    ...(label === undefined ? {} : { label }),
    observationIds: entity.observationIds,
  };
}

export function buildReviewCase(
  candidate: EventPairCandidate,
  records: readonly LogRecord[],
  options: FoldOptions,
): ReviewCase {
  return buildReviewCaseFromWorkspace(
    candidate,
    createReviewWorkspace(records, options),
  );
}

export function buildReviewCaseFromWorkspace(
  candidate: EventPairCandidate,
  workspace: ReviewWorkspace,
): ReviewCase {
  const { catalogue } = workspace;
  const [aId, bId] = candidate.eventIds;
  const a = findEvent(catalogue.events, aId);
  const b = findEvent(catalogue.events, bId);
  return {
    kind: "event-pair",
    eventDate: candidate.eventDate,
    a: buildSide(
      "A",
      a,
      workspace.index.observationsById,
      workspace.index.documentsById,
      workspace.options.rules,
      catalogue.venues,
    ),
    b: buildSide(
      "B",
      b,
      workspace.index.observationsById,
      workspace.index.documentsById,
      workspace.options.rules,
      catalogue.venues,
    ),
  };
}

export function buildVenueReviewCase(
  candidate: VenuePairCandidate,
  records: readonly LogRecord[],
  options: FoldOptions,
): VenueReviewCase {
  return buildVenueReviewCaseFromWorkspace(
    candidate,
    createReviewWorkspace(records, options),
  );
}

export function buildVenueReviewCaseFromWorkspace(
  candidate: VenuePairCandidate,
  workspace: ReviewWorkspace,
): VenueReviewCase {
  const [aId, bId] = candidate.venueIds;
  const findVenue = (venueId: string): ProjectedEntity => {
    const venue = workspace.catalogue.venues.find(
      (candidateVenue) => candidateVenue.id === venueId,
    );
    if (venue === undefined) {
      throw new Error(`buildVenueReviewCase: missing venue:${venueId}`);
    }
    return venue;
  };
  return {
    kind: "venue-pair",
    a: buildVenueSide("A", findVenue(aId), workspace),
    b: buildVenueSide("B", findVenue(bId), workspace),
  };
}

function buildVenueSide(
  label: "A" | "B",
  venue: ProjectedEntity,
  workspace: ReviewWorkspace,
): VenueReviewSide {
  const groupedObservations = venue.observationIds.map((observationId) =>
    lookUpObservation(observationId, workspace.index.observationsById),
  );
  const evidence = selectReadings(
    groupedObservations,
    workspace.index.observationsById,
    workspace.options.rules,
  )
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((observation) =>
      buildEvidence(
        observation,
        workspace.index.documentsById,
        comparedVenueFields,
      ),
    );
  const venueName = factString(venue.facts["venue_name"]);
  const city = factString(venue.facts["city"]);
  const address = factString(venue.facts["address"]);
  const neighbourhood = factString(venue.facts["neighbourhood"]);
  return {
    label,
    venueId: venue.id,
    observationIds: venue.observationIds,
    ...(venueName === undefined ? {} : { venueName }),
    ...(city === undefined ? {} : { city }),
    ...(address === undefined ? {} : { address }),
    ...(neighbourhood === undefined ? {} : { neighbourhood }),
    evidence,
  };
}

/** Full retained Documents behind a case, deterministic order, deduplicated. */
export function reviewCaseDocuments(
  reviewCase: ReviewCase | VenueReviewCase,
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
  venues: readonly ProjectedEntity[],
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
  const venue = resolveVenue(venueName, venues);

  // `observationIds` keeps every grouped Observation — a merge must re-point
  // all of them. Evidence narrows through the same lineage selection the
  // Fold applies, so a superseded reading never renders as if still current.
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
    ...(venue === undefined ? {} : { venue }),
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
  fields: readonly string[] = comparedEventFields,
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
    spans: comparedSpans(observation.claims, fields),
  };
}

function comparedSpans(
  claims: Readonly<Record<string, Claim | undefined>>,
  fields: readonly string[],
): string[] {
  const spans = new Set<string>();
  for (const field of fields) {
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
