const actorTrust = {
  human: 3,
  reader: 2,
  scorer: 1,
} as const;

interface RankedJudgement {
  readonly by: string;
  readonly at: string;
}

export function compareJudgementPrecedence(
  left: RankedJudgement,
  right: RankedJudgement,
): number {
  return (
    rankActor(left.by) - rankActor(right.by) || left.at.localeCompare(right.at)
  );
}

function rankActor(actor: string): number {
  if (actor.startsWith("person:")) {
    return actorTrust.human;
  }
  if (actor.startsWith("matcher")) {
    return actorTrust.scorer;
  }
  return actorTrust.reader;
}
