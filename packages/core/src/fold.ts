import type {
  Claim,
  Document,
  JsonValue,
  LogRecord,
  Observation,
} from "./records.js";
import {
  formatEntityReference,
  parseEntityReference,
} from "./entity-reference.js";
import { compareJudgementPrecedence } from "./judgement-precedence.js";

export interface FoldRules {
  readonly version: string;
  readonly extractorTrust: Readonly<Record<string, number>>;
}

export interface FoldOptions {
  readonly now: Date;
  readonly rules: FoldRules;
}

export type Confidence = "validated" | "corroborated" | "single-source";

export type ProjectedFact =
  | {
      readonly state: "known";
      readonly value: JsonValue;
      readonly confidence: Confidence;
      readonly evidence: string[];
    }
  | {
      readonly state: "unknown";
      readonly confidence: Confidence;
      readonly evidence: string[];
    };

export interface ProjectedEntity {
  readonly id: string;
  readonly observationIds: string[];
  readonly facts: Readonly<Record<string, ProjectedFact>>;
}

export interface Catalogue {
  readonly asOf: string;
  readonly events: ProjectedEntity[];
  readonly venues: ProjectedEntity[];
}

interface SourcedClaim {
  readonly claim: Claim;
  readonly observation: Observation;
  readonly source: string;
}

export function fold(
  records: readonly LogRecord[],
  { now, rules }: FoldOptions,
): Catalogue {
  const documents = new Map(
    records
      .filter((record): record is Document => record.type === "document")
      .map((document) => [document.id, document]),
  );
  const observations = records.filter(
    (record): record is Observation => record.type === "observation",
  );
  const redirects = buildRedirects(records);
  const matches = selectObservationMatches(records);
  const groups = new Map<string, Observation[]>();

  for (const observation of observations) {
    const matchedEntity = matches.get(observation.id);
    const intrinsicEntity = formatEntityReference(observation.subject);
    const entity = resolveRedirect(matchedEntity ?? intrinsicEntity, redirects);
    const group = groups.get(entity) ?? [];
    group.push(observation);
    groups.set(entity, group);
  }

  const events: ProjectedEntity[] = [];
  const venues: ProjectedEntity[] = [];
  for (const [entity, groupedObservations] of groups) {
    const { kind, id } = parseEntityReference(entity);
    const selectedObservations = selectReadings(groupedObservations, rules);
    const facts = resolveFacts(
      entity,
      selectedObservations,
      documents,
      records,
      redirects,
      rules,
    );
    const projected = {
      id,
      observationIds: groupedObservations
        .map((observation) => observation.id)
        .sort(),
      facts,
    };
    if (kind === "event") {
      events.push(projected);
    } else if (kind === "venue") {
      venues.push(projected);
    }
  }

  return {
    asOf: now.toISOString(),
    events: events.sort(compareEntityIds),
    venues: venues.sort(compareEntityIds),
  };
}

function compareEntityIds(
  left: ProjectedEntity,
  right: ProjectedEntity,
): number {
  return left.id.localeCompare(right.id);
}

function buildRedirects(records: readonly LogRecord[]): Map<string, string> {
  const redirects = new Map<string, string>();
  const ordered = records
    .filter((record) => record.type === "redirect")
    .toSorted((left, right) => left.at.localeCompare(right.at));
  for (const redirect of ordered) {
    redirects.set(redirect.from, redirect.to);
  }
  return redirects;
}

function resolveRedirect(
  entity: string,
  redirects: ReadonlyMap<string, string>,
): string {
  const visited = new Set<string>();
  let current = entity;
  while (redirects.has(current)) {
    if (visited.has(current)) {
      throw new Error(`redirect cycle at ${current}`);
    }
    visited.add(current);
    current = redirects.get(current) ?? current;
  }
  return current;
}

function selectObservationMatches(
  records: readonly LogRecord[],
): Map<string, string> {
  const candidates = new Map<string, Extract<LogRecord, { type: "match" }>[]>();
  for (const record of records) {
    if (
      record.type !== "match" ||
      record.subject.kind !== "observation" ||
      record.proposed === true
    ) {
      continue;
    }
    const matches = candidates.get(record.subject.id) ?? [];
    matches.push(record);
    candidates.set(record.subject.id, matches);
  }

  const selected = new Map<string, string>();
  for (const [observationId, matches] of candidates) {
    const match = matches.toSorted(compareMatches).at(-1);
    if (match?.verdict === "same") {
      selected.set(observationId, match.entity);
    }
  }
  return selected;
}

function compareMatches(
  left: Extract<LogRecord, { type: "match" }>,
  right: Extract<LogRecord, { type: "match" }>,
): number {
  return compareJudgementPrecedence(left, right);
}

function selectReadings(
  observations: readonly Observation[],
  rules: FoldRules,
): Observation[] {
  const byId = new Map(
    observations.map((observation) => [observation.id, observation]),
  );
  const lineages = new Map<string, Observation[]>();
  for (const observation of observations) {
    const root = findLineageRoot(observation, byId);
    const lineage = lineages.get(root) ?? [];
    lineage.push(observation);
    lineages.set(root, lineage);
  }
  return [...lineages.values()]
    .map(
      (lineage) =>
        lineage
          .toSorted(
            (left, right) =>
              extractorTrust(left, rules) - extractorTrust(right, rules) ||
              left.at.localeCompare(right.at),
          )
          .at(-1) ?? lineage[0],
    )
    .filter(
      (observation): observation is Observation => observation !== undefined,
    );
}

function findLineageRoot(
  observation: Observation,
  observations: ReadonlyMap<string, Observation>,
): string {
  const visited = new Set<string>();
  let current = observation;
  while (current.supersedes !== undefined) {
    if (visited.has(current.id)) {
      throw new Error(`Observation supersession cycle at ${current.id}`);
    }
    visited.add(current.id);
    const parent = observations.get(current.supersedes);
    if (parent === undefined) {
      break;
    }
    current = parent;
  }
  return current.id;
}

function extractorTrust(observation: Observation, rules: FoldRules): number {
  return rules.extractorTrust[observation.extractor] ?? 0;
}

function resolveFacts(
  entity: string,
  observations: readonly Observation[],
  documents: ReadonlyMap<string, Document>,
  records: readonly LogRecord[],
  redirects: ReadonlyMap<string, string>,
  rules: FoldRules,
): Readonly<Record<string, ProjectedFact>> {
  const claimsByField = new Map<string, SourcedClaim[]>();
  for (const observation of observations) {
    const document = documents.get(observation.document);
    if (document === undefined) {
      continue;
    }
    const source = document.v === 1 ? document.source : document.source.value;
    for (const [field, claim] of Object.entries(observation.claims)) {
      if (claim === undefined) {
        continue;
      }
      const claims = claimsByField.get(field) ?? [];
      claims.push({ claim, observation, source });
      claimsByField.set(field, claims);
    }
  }

  const facts: Record<string, ProjectedFact> = {};
  for (const [field, claims] of claimsByField) {
    const correctedClaims = selectLatestClaimsBySource(claims);
    facts[field] = selectSupportedValue(correctedClaims);
  }

  applyOverrides(facts, entity, records, redirects);
  applyValidations(facts, entity, records, redirects, rules);
  return facts;
}

function selectLatestClaimsBySource(
  claims: readonly SourcedClaim[],
): SourcedClaim[] {
  const latest = new Map<string, SourcedClaim>();
  for (const claim of claims) {
    const existing = latest.get(claim.source);
    if (
      existing === undefined ||
      existing.observation.at.localeCompare(claim.observation.at) < 0
    ) {
      latest.set(claim.source, claim);
    }
  }
  return [...latest.values()];
}

function selectSupportedValue(claims: readonly SourcedClaim[]): ProjectedFact {
  const support = new Map<string, SourcedClaim[]>();
  for (const claim of claims) {
    const key =
      "unknown" in claim.claim
        ? "unknown"
        : `value:${canonicalJson(claim.claim.value)}`;
    const group = support.get(key) ?? [];
    group.push(claim);
    support.set(key, group);
  }
  const winner = [...support.values()]
    .toSorted(
      (left, right) =>
        left.length - right.length ||
        newestObservationAt(left).localeCompare(newestObservationAt(right)),
    )
    .at(-1);
  if (winner === undefined) {
    throw new Error("cannot resolve a fact without claims");
  }

  const evidence = winner
    .toSorted((left, right) =>
      left.observation.at.localeCompare(right.observation.at),
    )
    .map((claim) => claim.observation.id);
  const confidence = winner.length > 1 ? "corroborated" : "single-source";
  const claim = winner[0]?.claim;
  if (claim === undefined || "unknown" in claim) {
    return { state: "unknown", confidence, evidence };
  }
  return { state: "known", value: claim.value, confidence, evidence };
}

function newestObservationAt(claims: readonly SourcedClaim[]): string {
  return claims.reduce(
    (latest, claim) =>
      claim.observation.at.localeCompare(latest) > 0
        ? claim.observation.at
        : latest,
    "",
  );
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function applyOverrides(
  facts: Record<string, ProjectedFact>,
  entity: string,
  records: readonly LogRecord[],
  redirects: ReadonlyMap<string, string>,
): void {
  const overrides = records
    .filter(
      (record): record is Extract<LogRecord, { type: "override" }> =>
        record.type === "override",
    )
    .filter(
      (override) => resolveRedirect(override.entity, redirects) === entity,
    )
    .toSorted((left, right) => left.at.localeCompare(right.at));
  for (const override of overrides) {
    facts[override.field] = {
      state: "known",
      value: override.value,
      confidence: "validated",
      evidence: [override.id],
    };
  }
}

function applyValidations(
  facts: Record<string, ProjectedFact>,
  entity: string,
  records: readonly LogRecord[],
  redirects: ReadonlyMap<string, string>,
  rules: FoldRules,
): void {
  for (const validation of records) {
    if (
      validation.type !== "validation" ||
      validation.target.kind !== "fact" ||
      resolveRedirect(validation.target.entity, redirects) !== entity ||
      validation.rules !== rules.version
    ) {
      continue;
    }
    const fact = facts[validation.target.field];
    if (
      fact?.state === "known" &&
      canonicalJson(fact.value) === canonicalJson(validation.vouched_for)
    ) {
      facts[validation.target.field] = {
        ...fact,
        confidence: "validated",
        evidence: [...fact.evidence, validation.id],
      };
    }
  }
}
