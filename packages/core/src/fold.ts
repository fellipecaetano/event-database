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
  readonly sourceTrust: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly sourceTrustOverrides: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
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
  readonly staleValidationIds: string[];
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
  readonly sourceTime: string;
  readonly trust: number;
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
  const observationsById = new Map(
    observations.map((observation) => [observation.id, observation]),
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
    const selectedObservations = selectReadings(
      groupedObservations,
      observationsById,
      rules,
    );
    const facts = resolveFacts(
      entity,
      selectedObservations,
      documents,
      records,
      redirects,
      rules,
    );
    const { existence, staleValidationIds } = projectExistence(
      entity,
      selectedObservations,
      documents,
      records,
      redirects,
      rules,
      facts,
    );
    const projectedFacts = { ...facts, existence };
    const projected = {
      id,
      observationIds: groupedObservations
        .map((observation) => observation.id)
        .sort(),
      facts: projectedFacts,
      staleValidationIds,
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
    const pair = `${record.subject.id}\u0000${record.entity}`;
    const matches = candidates.get(pair) ?? [];
    matches.push(record);
    candidates.set(pair, matches);
  }

  const accepted = new Map<string, Extract<LogRecord, { type: "match" }>[]>();
  for (const matches of candidates.values()) {
    const match = matches.toSorted(compareMatches).at(-1);
    if (match?.verdict !== "same" || match.subject.kind !== "observation") {
      continue;
    }
    const same = accepted.get(match.subject.id) ?? [];
    same.push(match);
    accepted.set(match.subject.id, same);
  }
  const selected = new Map<string, string>();
  for (const [observationId, matches] of accepted) {
    const match = matches.toSorted(compareMatches).at(-1);
    if (match !== undefined) {
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

/**
 * Narrows a group of Observations to the most-trusted, most-recent reading
 * per supersession lineage — the same collapse the Fold applies before
 * resolving facts, so callers outside `fold` don't re-derive it and risk
 * presenting a superseded reading as if it were still live.
 */
export function selectReadings(
  observations: readonly Observation[],
  allObservations: ReadonlyMap<string, Observation>,
  rules: FoldRules,
): Observation[] {
  const lineages = new Map<string, Observation[]>();
  for (const observation of observations) {
    const root = findLineageRoot(observation, allObservations);
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
    if (
      parent.document !== current.document ||
      parent.subject.kind !== current.subject.kind ||
      parent.subject.id !== current.subject.id
    ) {
      throw new Error(
        "Observation supersession must preserve Document and subject identity",
      );
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
  const sourceKinds = buildSourceKinds(records);
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
      claims.push({
        claim,
        observation,
        source,
        sourceTime: documentSourceTime(document),
        trust: sourceTrust(
          source,
          sourceKinds.get(source),
          observation.subject.kind,
          field,
          rules,
        ),
      });
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
      existing.sourceTime.localeCompare(claim.sourceTime) < 0 ||
      (existing.sourceTime === claim.sourceTime &&
        existing.observation.at.localeCompare(claim.observation.at) < 0)
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
        strongestTrust(left) - strongestTrust(right) ||
        left.length - right.length ||
        newestSourceTime(left).localeCompare(newestSourceTime(right)),
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

function strongestTrust(claims: readonly SourcedClaim[]): number {
  return Math.max(...claims.map((claim) => claim.trust));
}

function newestSourceTime(claims: readonly SourcedClaim[]): string {
  return claims.reduce(
    (latest, claim) =>
      claim.sourceTime.localeCompare(latest) > 0 ? claim.sourceTime : latest,
    "",
  );
}

function documentSourceTime(document: Document): string {
  const publishedAt =
    document.v === 1 ? document.published_at : document.published_at?.value;
  return publishedAt ?? document.retrieved_at;
}

function buildSourceKinds(records: readonly LogRecord[]): Map<string, string> {
  const kinds = new Map<string, string>();
  const overrides = records
    .filter(
      (record): record is Extract<LogRecord, { type: "override" }> =>
        record.type === "override" &&
        record.entity.startsWith("source:") &&
        record.field === "kind",
    )
    .toSorted((left, right) => left.at.localeCompare(right.at));
  for (const override of overrides) {
    if (typeof override.value === "string") {
      kinds.set(override.entity.slice("source:".length), override.value);
    }
  }
  return kinds;
}

function sourceTrust(
  source: string,
  kind: string | undefined,
  subjectKind: Observation["subject"]["kind"],
  field: string,
  rules: FoldRules,
): number {
  const qualifiedField = `${subjectKind}.${field}`;
  return (
    rules.sourceTrustOverrides[source]?.[qualifiedField] ??
    rules.sourceTrustOverrides[source]?.[field] ??
    (kind === undefined
      ? undefined
      : (rules.sourceTrust[kind]?.[qualifiedField] ??
        rules.sourceTrust[kind]?.[field])) ??
    0
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

function projectExistence(
  entity: string,
  observations: readonly Observation[],
  documents: ReadonlyMap<string, Document>,
  records: readonly LogRecord[],
  redirects: ReadonlyMap<string, string>,
  rules: FoldRules,
  facts: Readonly<Record<string, ProjectedFact>>,
): {
  readonly existence: ProjectedFact;
  readonly staleValidationIds: string[];
} {
  const sources = new Set<string>();
  for (const observation of observations) {
    const document = documents.get(observation.document);
    if (document !== undefined) {
      sources.add(document.v === 1 ? document.source : document.source.value);
    }
  }
  const evidence = observations.map((observation) => observation.id).sort();
  let confidence: Confidence =
    sources.size > 1 ? "corroborated" : "single-source";
  const staleValidationIds: string[] = [];
  const validations = records.filter(
    (record): record is Extract<LogRecord, { type: "validation" }> =>
      record.type === "validation" &&
      record.target.kind !== "fact" &&
      resolveRedirect(formatEntityReference(record.target), redirects) ===
        entity,
  );
  for (const validation of validations) {
    if (
      validation.rules === rules.version &&
      validationMatchesFacts(validation.vouched_for, facts)
    ) {
      confidence = "validated";
      evidence.push(validation.id);
    } else {
      staleValidationIds.push(validation.id);
    }
  }
  return {
    existence: {
      state: "known",
      value: true,
      confidence,
      evidence,
    },
    staleValidationIds: staleValidationIds.sort(),
  };
}

function validationMatchesFacts(
  vouchedFor: JsonValue,
  facts: Readonly<Record<string, ProjectedFact>>,
): boolean {
  if (
    vouchedFor === null ||
    Array.isArray(vouchedFor) ||
    typeof vouchedFor !== "object"
  ) {
    return false;
  }
  return Object.entries(vouchedFor).every(([field, expected]) => {
    const fact = facts[field];
    return (
      fact?.state === "known" &&
      canonicalJson(fact.value) === canonicalJson(expected)
    );
  });
}
