import type { FoldRules } from "./fold.js";
import type { Observation } from "./records.js";

/**
 * Narrows a group of Observations to the most-trusted, most-recent reading
 * per supersession lineage before facts are resolved.
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
