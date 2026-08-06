import type { FoldRules, ProjectedFact } from "./fold.js";
import { resolveRedirect } from "./identity-resolution.js";
import { parseEntityReference } from "./entity-reference.js";
import type {
  Claim,
  Document,
  JsonValue,
  LogRecord,
  Observation,
} from "./records.js";

interface SourcedClaim {
  readonly claim: Claim;
  readonly observation: Observation;
  readonly source: string;
  readonly sourceTime: string;
  readonly trust: number;
}

export function resolveFacts(
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
    facts[field] = selectSupportedValue(selectLatestClaimsBySource(claims));
  }
  applyOverrides(facts, entity, records, redirects);
  applyValidations(facts, entity, records, redirects, rules);
  return facts;
}

export function canonicalJson(value: JsonValue): string {
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
        : `value:${canonicalJson({
            value: claim.claim.value,
            currency: claim.claim.currency ?? null,
          })}`;
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
  return {
    state: "known",
    value: claim.value,
    ...(claim.currency === undefined ? {} : { currency: claim.currency }),
    confidence,
    evidence,
  };
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
        parseEntityReference(record.entity).kind === "source" &&
        record.field === "kind",
    )
    .toSorted((left, right) => left.at.localeCompare(right.at));
  for (const override of overrides) {
    if (typeof override.value === "string") {
      kinds.set(parseEntityReference(override.entity).id, override.value);
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
