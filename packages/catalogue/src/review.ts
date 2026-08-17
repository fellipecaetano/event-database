import {
  buildProposalCaseFromWorkspace,
  buildReviewCaseFromWorkspace,
  buildReviewQueueFromWorkspace,
  buildVenueReviewCaseFromWorkspace,
  documentSourceName,
  type EventPairDecisionTarget,
  type ProposalCase,
  type ProposalDecisionTarget,
  type ReviewCandidate,
  type ReviewCase,
  type ReviewWorkspace,
  type VenuePairDecisionTarget,
  type VenueReviewCase,
} from "@event-database/core";

import { type OpenCatalogueOptions } from "./index.js";
import { deepFreezeCopy } from "./immutable.js";
import { openCatalogueContext } from "./open-context.js";

declare const reviewHandleBrand: unique symbol;
export interface ReviewHandle {
  readonly [reviewHandleBrand]: true;
}

export interface ReviewDocument {
  readonly id: string;
  readonly sourceName: string;
  readonly text: string;
}

export interface ReviewExplanation {
  readonly reasons: readonly string[];
}

export type InteractiveReviewItem =
  | {
      readonly kind: "proposal";
      readonly handle: ReviewHandle;
      readonly reviewCase: ProposalCase;
      readonly decisionTarget: ProposalDecisionTarget;
    }
  | {
      readonly kind: "event-pair";
      readonly handle: ReviewHandle;
      readonly reviewCase: ReviewCase;
      readonly decisionTarget: EventPairDecisionTarget;
    }
  | {
      readonly kind: "venue-pair";
      readonly handle: ReviewHandle;
      readonly reviewCase: VenueReviewCase;
      readonly decisionTarget: VenuePairDecisionTarget;
    };

export interface ReviewCatalogue {
  machineQueue(): readonly ReviewCandidate[];
  interactiveQueue(): readonly InteractiveReviewItem[];
  documentsFor(handle: ReviewHandle): readonly ReviewDocument[];
  explanation(handle: ReviewHandle): ReviewExplanation;
}

export class StaleReviewHandleError extends Error {
  constructor() {
    super("review handle belongs to a different catalogue snapshot");
    this.name = "StaleReviewHandleError";
  }
}

interface HandleEntry {
  readonly candidate: ReviewCandidate;
  readonly reviewCase: ProposalCase | ReviewCase | VenueReviewCase;
}

export async function openReviewCatalogue(
  options: OpenCatalogueOptions,
): Promise<ReviewCatalogue> {
  const context = await openCatalogueContext(options);
  const workspace: ReviewWorkspace = {
    index: context.index,
    catalogue: context.projection,
    options: { now: context.at, rules: context.rules },
  };
  const candidates = buildReviewQueueFromWorkspace(workspace);
  const entries = new WeakMap<object, HandleEntry>();
  const interactive = candidates.map((candidate): InteractiveReviewItem => {
    const handle = Object.freeze({}) as ReviewHandle;
    if (candidate.kind === "proposal") {
      const reviewCase = buildProposalCaseFromWorkspace(candidate, workspace);
      entries.set(handle, { candidate, reviewCase });
      return Object.freeze({
        kind: candidate.kind,
        handle,
        reviewCase: deepFreezeCopy(reviewCase),
        decisionTarget: deepFreezeCopy(proposalDecisionTarget(reviewCase)),
      });
    }
    if (candidate.kind === "venue-pair") {
      const reviewCase = buildVenueReviewCaseFromWorkspace(
        candidate,
        workspace,
      );
      entries.set(handle, { candidate, reviewCase });
      return Object.freeze({
        kind: candidate.kind,
        handle,
        reviewCase: deepFreezeCopy(reviewCase),
        decisionTarget: deepFreezeCopy(venueDecisionTarget(reviewCase)),
      });
    }
    const reviewCase = buildReviewCaseFromWorkspace(candidate, workspace);
    entries.set(handle, { candidate, reviewCase });
    return Object.freeze({
      kind: candidate.kind,
      handle,
      reviewCase: deepFreezeCopy(reviewCase),
      decisionTarget: deepFreezeCopy(eventDecisionTarget(reviewCase)),
    });
  });
  const machineQueue = deepFreezeCopy(candidates);
  const interactiveQueue = Object.freeze([...interactive]);
  const documents = new Map(
    context.records
      .filter((record) => record.type === "document")
      .map((document) => [document.id, document]),
  );

  function entryFor(handle: ReviewHandle): HandleEntry {
    const entry = entries.get(handle);
    if (entry === undefined) throw new StaleReviewHandleError();
    return entry;
  }

  return Object.freeze({
    machineQueue: () => machineQueue,
    interactiveQueue: () => interactiveQueue,
    documentsFor: (handle: ReviewHandle) => {
      const entry = entryFor(handle);
      const ids = new Set<string>();
      if (entry.reviewCase.kind === "proposal") {
        for (const evidence of entry.reviewCase.evidence) {
          ids.add(evidence.documentId);
        }
      } else {
        for (const evidence of [
          ...entry.reviewCase.a.evidence,
          ...entry.reviewCase.b.evidence,
        ]) {
          ids.add(evidence.documentId);
        }
      }
      return deepFreezeCopy(
        [...ids].toSorted().map((id) => {
          const document = documents.get(id);
          if (document === undefined) {
            throw new Error(`review invariant failed: missing Document ${id}`);
          }
          return {
            id: document.id,
            sourceName: documentSourceName(document),
            text: document.text,
          };
        }),
      );
    },
    explanation: (handle: ReviewHandle) => {
      const { candidate } = entryFor(handle);
      return deepFreezeCopy({
        reasons: candidate.kind === "proposal" ? [] : candidate.reasons,
      });
    },
  });
}

function proposalDecisionTarget(
  reviewCase: ProposalCase,
): ProposalDecisionTarget {
  return {
    subject: reviewCase.subject,
    entity: reviewCase.entity,
    from: {
      id: reviewCase.from.id,
      observationIds: reviewCase.from.observationIds,
    },
  };
}

function venueDecisionTarget(
  reviewCase: VenueReviewCase,
): VenuePairDecisionTarget {
  return {
    kind: "venue-pair",
    a: {
      venueId: reviewCase.a.venueId,
      observationIds: reviewCase.a.observationIds,
    },
    b: {
      venueId: reviewCase.b.venueId,
      observationIds: reviewCase.b.observationIds,
    },
  };
}

function eventDecisionTarget(reviewCase: ReviewCase): EventPairDecisionTarget {
  return {
    a: {
      eventId: reviewCase.a.eventId,
      observationIds: reviewCase.a.observationIds,
      ...(reviewCase.a.venue === undefined
        ? {}
        : { venue: reviewCase.a.venue }),
    },
    b: {
      eventId: reviewCase.b.eventId,
      observationIds: reviewCase.b.observationIds,
      ...(reviewCase.b.venue === undefined
        ? {}
        : { venue: reviewCase.b.venue }),
    },
  };
}
