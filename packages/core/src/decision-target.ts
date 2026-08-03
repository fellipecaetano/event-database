import type { LogRecord } from "./records.js";

type MatchRecord = Extract<LogRecord, { type: "match" }>;

export interface DecisionVenueTarget {
  readonly id: string;
  readonly observationIds: readonly string[];
}

export interface EventDecisionSide {
  readonly eventId: string;
  readonly observationIds: readonly string[];
  readonly venue?: DecisionVenueTarget;
}

export interface EventPairDecisionTarget {
  /** Retained for callers passing a ReviewCase directly. */
  readonly kind?: "event-pair";
  readonly eventDate?: string;
  readonly a: EventDecisionSide;
  readonly b: EventDecisionSide;
}

export interface VenueDecisionSide {
  readonly venueId: string;
  readonly observationIds: readonly string[];
}

export interface VenuePairDecisionTarget {
  readonly kind: "venue-pair";
  readonly a: VenueDecisionSide;
  readonly b: VenueDecisionSide;
}

export interface ProposalDecisionTarget {
  readonly subject: MatchRecord["subject"];
  readonly entity: string;
  readonly from: {
    readonly id: string;
    readonly observationIds: readonly string[];
  };
}
