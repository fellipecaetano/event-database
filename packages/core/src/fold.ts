import {
  formatEntityReference,
  parseEntityReference,
} from "./entity-reference.js";
import { projectExistence } from "./existence-projection.js";
import { resolveFacts } from "./fact-resolution.js";
import {
  buildRedirects,
  resolveRedirect,
  selectObservationMatches,
} from "./identity-resolution.js";
import { indexLog } from "./log-index.js";
import { selectReadings } from "./reading-selection.js";
import type { JsonValue, LogRecord, Observation } from "./records.js";

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
      readonly currency?: string;
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

export function fold(
  records: readonly LogRecord[],
  { now, rules }: FoldOptions,
): Catalogue {
  const index = indexLog(records);
  const redirects = buildRedirects(index);
  const matches = selectObservationMatches(index);
  const groups = new Map<string, Observation[]>();

  for (const observation of index.observations) {
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
      index.observationsById,
      rules,
    );
    const facts = resolveFacts(
      entity,
      selectedObservations,
      index.documentsById,
      index.records,
      redirects,
      rules,
    );
    const { existence, staleValidationIds } = projectExistence(
      entity,
      selectedObservations,
      index.documentsById,
      index.records,
      redirects,
      rules,
      facts,
    );
    const projected = {
      id,
      observationIds: groupedObservations
        .map((observation) => observation.id)
        .sort(),
      facts: { ...facts, existence },
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

export { selectReadings } from "./reading-selection.js";
