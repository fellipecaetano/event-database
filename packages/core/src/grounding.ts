import { recordVersions, type Document, type Observation } from "./records.js";

export interface GroundedSpan {
  readonly field: string;
  readonly span: string;
}

export function documentMetadataSpans(
  document: Extract<Document, { v: typeof recordVersions.document.current }>,
): GroundedSpan[] {
  return [
    { field: "source", metadata: document.source },
    { field: "origin", metadata: document.origin },
    { field: "published_at", metadata: document.published_at },
  ].flatMap(({ field, metadata }) =>
    (metadata?.spans ?? []).map((span) => ({ field, span })),
  );
}

export function observationClaimSpans(
  observation: Observation,
): GroundedSpan[] {
  return [
    ...Object.entries(observation.claims),
    ...Object.entries(observation.extras),
  ].flatMap(([field, claim]) =>
    claim === undefined ? [] : claim.spans.map((span) => ({ field, span })),
  );
}
