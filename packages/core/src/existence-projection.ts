import type { Confidence, FoldRules, ProjectedFact } from "./fold.js";
import { canonicalJson } from "./fact-resolution.js";
import { formatEntityReference } from "./entity-reference.js";
import { resolveRedirect } from "./identity-resolution.js";
import type { Document, JsonValue, LogRecord, Observation } from "./records.js";

export function projectExistence(
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
    existence: { state: "known", value: true, confidence, evidence },
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
