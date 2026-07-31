import { compareJudgementPrecedence } from "./judgement-precedence.js";
import type { LogIndex } from "./log-index.js";
import type { LogRecord } from "./records.js";

type MatchRecord = Extract<LogRecord, { type: "match" }>;

export function buildRedirects(index: LogIndex): ReadonlyMap<string, string> {
  const redirects = new Map<string, string>();
  for (const redirect of index.redirects.toSorted((left, right) =>
    left.at.localeCompare(right.at),
  )) {
    redirects.set(redirect.from, redirect.to);
  }
  return redirects;
}

export function resolveRedirect(
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

export function selectObservationMatches(
  index: LogIndex,
): ReadonlyMap<string, string> {
  const candidates = new Map<string, MatchRecord[]>();
  for (const match of index.matches) {
    if (match.subject.kind !== "observation" || match.proposed === true) {
      continue;
    }
    const key = `${match.subject.id}\u0000${match.entity}`;
    const records = candidates.get(key) ?? [];
    records.push(match);
    candidates.set(key, records);
  }

  const accepted = new Map<string, MatchRecord[]>();
  for (const candidatesForTarget of candidates.values()) {
    const match = candidatesForTarget
      .toSorted(compareJudgementPrecedence)
      .at(-1);
    if (match?.verdict !== "same" || match.subject.kind !== "observation") {
      continue;
    }
    const records = accepted.get(match.subject.id) ?? [];
    records.push(match);
    accepted.set(match.subject.id, records);
  }

  return new Map(
    [...accepted].flatMap(([observationId, matches]) => {
      const match = matches.toSorted(compareJudgementPrecedence).at(-1);
      return match === undefined
        ? []
        : [[observationId, match.entity] as const];
    }),
  );
}
