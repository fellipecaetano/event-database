import { z } from "zod";

import {
  matchSchema,
  overrideSchema,
  redirectSchema,
  recordVersions,
  validationSchema,
  type Judgement,
} from "./records.js";
import { parseEntityReference } from "./entity-reference.js";
import type { ProposalCase, ReviewCase, ReviewSide } from "./review.js";

export const judgementDraftSchema = z.discriminatedUnion("type", [
  matchSchema.omit({ id: true, at: true, v: true }),
  overrideSchema.omit({ id: true, at: true, v: true }),
  validationSchema.omit({ id: true, at: true, v: true }),
  redirectSchema.omit({ id: true, at: true, v: true }),
]);

export type JudgementDraft = z.output<typeof judgementDraftSchema>;

interface JudgementContext {
  readonly id: string;
  readonly at: string;
}

export function prepareJudgement(
  input: JudgementDraft,
  context: JudgementContext,
): Judgement {
  const draft = judgementDraftSchema.parse(input);
  switch (draft.type) {
    case "match":
      return matchSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.match,
      });
    case "override":
      return overrideSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.override,
      });
    case "redirect":
      return redirectSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.redirect,
      });
    case "validation":
      return validationSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.validation,
      });
  }
  throw new Error("unsupported Judgement draft");
}

export interface ReviewedDecision {
  readonly reviewCase: ReviewCase;
  readonly verdict: "same" | "different" | "deferred";
  /** `person:<id>` reviewer. */
  readonly by: string;
  readonly reason?: string;
  /** Required when and only when the verdict is `same`. */
  readonly survivingEventId?: string;
}

interface ReviewDecisionContext {
  readonly at: string;
  readonly nextId: () => string;
}

export function prepareReviewDecision(
  decision: ReviewedDecision,
  context: ReviewDecisionContext,
): Judgement[] {
  const { reviewCase, verdict, by, reason, survivingEventId } = decision;

  if (by.length === 0) {
    throw new Error(
      "prepareReviewDecision: an unattributed decision needs a reviewer (by)",
    );
  }
  if (reason?.length === 0) {
    throw new Error(
      "prepareReviewDecision: reason must not be empty when supplied",
    );
  }

  if (verdict === "same") {
    return prepareMerge(reviewCase, by, reason, survivingEventId, context);
  }

  if (survivingEventId !== undefined) {
    throw new Error(
      `prepareReviewDecision: survivingEventId is not allowed for a ${verdict} verdict`,
    );
  }

  const representative = representativeObservationId(reviewCase.a);
  const match = prepareJudgement(
    {
      type: "match",
      subject: { kind: "observation", id: representative },
      entity: `event:${reviewCase.b.eventId}`,
      verdict,
      by,
      ...(reason === undefined ? {} : { reason }),
    },
    { id: context.nextId(), at: context.at },
  );
  return [match];
}

export interface ProposalDecision {
  readonly proposal: ProposalCase;
  readonly verdict: "same" | "different" | "deferred";
  /** `person:<id>` reviewer. */
  readonly by: string;
  readonly reason?: string;
}

/**
 * Answers a standing proposal. Every branch emits a settled Match at the
 * proposal's own subject and entity, which is what stops it being raised
 * again — a proposal answered by anything but its own key would resurface.
 */
export function prepareProposalDecision(
  decision: ProposalDecision,
  context: ReviewDecisionContext,
): Judgement[] {
  const { proposal, verdict, by, reason } = decision;

  if (by.length === 0) {
    throw new Error(
      "prepareProposalDecision: an unattributed decision needs a reviewer (by)",
    );
  }
  if (reason?.length === 0) {
    throw new Error(
      "prepareProposalDecision: reason must not be empty when supplied",
    );
  }

  if (verdict !== "same") {
    return [
      prepareJudgement(
        {
          type: "match",
          subject: proposal.subject,
          entity: proposal.entity,
          verdict,
          by,
          ...(reason === undefined ? {} : { reason }),
        },
        { id: context.nextId(), at: context.at },
      ),
    ];
  }

  // Confirming runs in the direction the proposal was raised: everything under
  // `from` moves onto the target, and `from` retires behind a Redirect.
  const kind = parseEntityReference(proposal.entity).kind;
  const matches = [...proposal.from.observationIds]
    .toSorted((left, right) => left.localeCompare(right))
    .map((observationId) =>
      prepareJudgement(
        {
          type: "match",
          subject: { kind: "observation", id: observationId },
          entity: proposal.entity,
          verdict: "same",
          by,
          ...(reason === undefined ? {} : { reason }),
        },
        { id: context.nextId(), at: context.at },
      ),
    );

  const redirect = prepareJudgement(
    {
      type: "redirect",
      from: `${kind}:${proposal.from.id}`,
      to: proposal.entity,
      reason: reason ?? "merged",
    },
    { id: context.nextId(), at: context.at },
  );

  return [...matches, redirect];
}

function prepareMerge(
  reviewCase: ReviewCase,
  by: string,
  reason: string | undefined,
  survivingEventId: string | undefined,
  context: ReviewDecisionContext,
): Judgement[] {
  if (survivingEventId === undefined) {
    throw new Error(
      "prepareReviewDecision: a same verdict requires a survivingEventId",
    );
  }
  const { survivor, loser } = resolveSides(reviewCase, survivingEventId);

  const matches = [...loser.observationIds]
    .toSorted((left, right) => left.localeCompare(right))
    .map((observationId) =>
      prepareJudgement(
        {
          type: "match",
          subject: { kind: "observation", id: observationId },
          entity: `event:${survivor.eventId}`,
          verdict: "same",
          by,
          ...(reason === undefined ? {} : { reason }),
        },
        { id: context.nextId(), at: context.at },
      ),
    );

  const redirect = prepareJudgement(
    {
      type: "redirect",
      from: `event:${loser.eventId}`,
      to: `event:${survivor.eventId}`,
      reason: reason ?? "merged",
    },
    { id: context.nextId(), at: context.at },
  );

  return [
    ...matches,
    redirect,
    ...raiseVenueProposal(survivor, loser, by, context),
  ];
}

/**
 * One Event at two Venues means the two Venues are one — but acting on that
 * silently would let a single wrong Event merge quietly collapse two real
 * rooms, so it is raised as a proposal and confirmed by a person.
 */
function raiseVenueProposal(
  survivor: ReviewSide,
  loser: ReviewSide,
  by: string,
  context: ReviewDecisionContext,
): Judgement[] {
  const target = survivor.venue;
  const moving = loser.venue;
  if (target === undefined || moving === undefined || target.id === moving.id) {
    return [];
  }
  const [representative] = [...moving.observationIds].toSorted((left, right) =>
    left.localeCompare(right),
  );
  if (representative === undefined) {
    return [];
  }
  return [
    prepareJudgement(
      {
        type: "match",
        subject: { kind: "observation", id: representative },
        entity: `venue:${target.id}`,
        verdict: "same",
        by,
        proposed: true,
        reason: `raised by confirming event:${survivor.eventId} and event:${loser.eventId} are one Event`,
      },
      { id: context.nextId(), at: context.at },
    ),
  ];
}

function resolveSides(
  reviewCase: ReviewCase,
  survivingEventId: string,
): { readonly survivor: ReviewSide; readonly loser: ReviewSide } {
  if (reviewCase.a.eventId === survivingEventId) {
    return { survivor: reviewCase.a, loser: reviewCase.b };
  }
  if (reviewCase.b.eventId === survivingEventId) {
    return { survivor: reviewCase.b, loser: reviewCase.a };
  }
  throw new Error(
    `prepareReviewDecision: survivingEventId ${survivingEventId} is not part of this case`,
  );
}

function representativeObservationId(side: ReviewSide): string {
  const [representative] = [...side.observationIds].toSorted((left, right) =>
    left.localeCompare(right),
  );
  if (representative === undefined) {
    throw new Error(
      `prepareReviewDecision: side ${side.label} has no Observations`,
    );
  }
  return representative;
}
