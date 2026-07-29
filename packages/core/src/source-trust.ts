const eventProgrammeFields = [
  "title",
  "date",
  "start",
  "showtime",
  "end",
  "venue_name",
  "lineup",
  "genre_words",
  "status",
] as const;
const ticketingFields = [
  "price_from",
  "tickets_exist",
  "ticket_url",
  "tickets_at_door",
] as const;
const venueDetailFields = [
  "venue_name",
  "city",
  "address",
  "neighbourhood",
  "opening_hours",
] as const;

type TrustRank = 0 | 1 | 2;
const trust = {
  low: 0,
  normal: 1,
  high: 2,
} as const satisfies Record<string, TrustRank>;

function profile(
  eventProgramme: TrustRank,
  ticketing: TrustRank,
  venueDetails: TrustRank,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const field of eventProgrammeFields) {
    result[`event.${field}`] = eventProgramme;
  }
  for (const field of ticketingFields) {
    result[`event.${field}`] = ticketing;
  }
  for (const field of venueDetailFields) {
    result[`venue.${field}`] = venueDetails;
  }
  return result;
}

export const sourceTrustProfiles = {
  "venue-channel": profile(trust.high, trust.normal, trust.high),
  ticketing: profile(trust.normal, trust.high, trust.low),
  listings: profile(trust.normal, trust.normal, trust.low),
  promoter: profile(trust.high, trust.normal, trust.low),
  aggregator: profile(trust.low, trust.low, trust.low),
  directory: profile(trust.low, trust.low, trust.high),
  self: profile(trust.high, trust.high, trust.high),
} as const;
