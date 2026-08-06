import { createHash } from "node:crypto";

import type {
  Catalogue,
  ProjectedEntity,
  ProjectedFact,
} from "@event-database/core";

export type EventPeriod = "future" | "past";

export interface PublicEvent {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly start?: string;
  readonly showtime?: string;
  readonly end?: string;
  readonly venue: string;
  readonly lineup: readonly string[];
  readonly genres: readonly string[];
  readonly price?: number;
  readonly currency?: string;
  readonly ticketUrl?: string;
  readonly ticketsExist?: boolean;
  readonly ticketsAtDoor?: boolean;
  readonly status?: "scheduled" | "cancelled" | "postponed" | "sold_out";
  readonly period: EventPeriod;
  readonly happeningNow: boolean;
}

export interface SiteModel {
  readonly future: readonly PublicEvent[];
  readonly pastByYear: ReadonlyMap<string, readonly PublicEvent[]>;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly excluded: number;
}

const saoPaulo = "America/Sao_Paulo";
const yearLength = 4;
const dateLength = 10;
const publicIdBytes = 16;

export function buildSiteModel(catalogue: Catalogue): SiteModel {
  const now = new Date(catalogue.asOf);
  const today = dateInSaoPaulo(now);
  const diagnostics: { code: string; message: string }[] = [];
  const events: PublicEvent[] = [];

  for (const entity of catalogue.events) {
    const event = projectEvent(entity, now, today, diagnostics);
    if (event !== undefined) {
      events.push(event);
    }
  }

  const future = events
    .filter((event) => event.period === "future")
    .toSorted(compareFuture);
  const past = events
    .filter((event) => event.period === "past")
    .toSorted(comparePast);
  const pastByYear = new Map<string, PublicEvent[]>();
  for (const event of past) {
    const year = event.date.slice(0, yearLength);
    const yearEvents = pastByYear.get(year) ?? [];
    yearEvents.push(event);
    pastByYear.set(year, yearEvents);
  }

  return {
    future,
    pastByYear,
    diagnostics,
    excluded: catalogue.events.length - events.length,
  };
}

function projectEvent(
  entity: ProjectedEntity,
  now: Date,
  today: string,
  diagnostics: { code: string; message: string }[],
): PublicEvent | undefined {
  if (knownBoolean(entity.facts["existence"]) !== true) {
    return undefined;
  }
  const date = eventDate(entity.facts);
  if (date === undefined) {
    diagnostics.push({
      code: "undated-event",
      message: "excluded an Event without a date",
    });
    return undefined;
  }
  const title = knownString(entity.facts["title"]);
  const lineup = knownStrings(entity.facts["lineup"]);
  if (title === undefined && lineup.length === 0) {
    diagnostics.push({
      code: "unpublishable-event",
      message: "excluded an Event without a title or lineup",
    });
    return undefined;
  }
  const start = knownDateTime(entity.facts["start"]);
  const showtime = knownDateTime(entity.facts["showtime"]);
  const end = knownDateTime(entity.facts["end"]);
  const startInstant = instantFor(start);
  const endInstant = instantFor(end);
  if (
    startInstant !== undefined &&
    endInstant !== undefined &&
    endInstant < startInstant
  ) {
    throw new Error("cannot publish an Event whose End precedes its Start");
  }
  if (
    date !== dateFor(start) &&
    start !== undefined &&
    knownString(entity.facts["date"]) !== undefined
  ) {
    diagnostics.push({
      code: "temporal-disagreement",
      message: "Start differs from Event date",
    });
  }
  if (
    date !== dateFor(showtime) &&
    showtime !== undefined &&
    knownString(entity.facts["date"]) !== undefined
  ) {
    diagnostics.push({
      code: "temporal-disagreement",
      message: "Showtime differs from Event date",
    });
  }
  const period =
    endInstant !== undefined
      ? endInstant >= now
        ? "future"
        : "past"
      : date >= today
        ? "future"
        : "past";
  const price = knownNumber(entity.facts["price_from"]);
  const currency =
    entity.facts["price_from"]?.state === "known"
      ? entity.facts["price_from"].currency
      : undefined;
  if (price !== undefined && currency === undefined) {
    diagnostics.push({
      code: "missing-currency",
      message: "price has no currency",
    });
  }
  const ticketUrl = safeTicketUrl(knownString(entity.facts["ticket_url"]));
  if (
    knownString(entity.facts["ticket_url"]) !== undefined &&
    ticketUrl === undefined
  ) {
    diagnostics.push({
      code: "unsafe-ticket-url",
      message: "omitted an unsafe ticket URL",
    });
  }
  const ticketsExist = knownBoolean(entity.facts["tickets_exist"]);
  const ticketsAtDoor = knownBoolean(entity.facts["tickets_at_door"]);
  const status = knownStatus(entity.facts["status"]);
  return {
    id: publicEventId(entity.id),
    title: title ?? lineup.join(" + "),
    date,
    ...(start === undefined ? {} : { start }),
    ...(showtime === undefined ? {} : { showtime }),
    ...(end === undefined ? {} : { end }),
    venue: knownString(entity.facts["venue_name"]) ?? "Local a confirmar",
    lineup,
    genres: knownStrings(entity.facts["genre_words"]),
    ...(price === undefined ? {} : { price }),
    ...(currency === undefined ? {} : { currency }),
    ...(ticketUrl === undefined ? {} : { ticketUrl }),
    ...(ticketsExist === undefined ? {} : { ticketsExist }),
    ...(ticketsAtDoor === undefined ? {} : { ticketsAtDoor }),
    ...(status === undefined ? {} : { status }),
    period,
    happeningNow:
      startInstant !== undefined &&
      endInstant !== undefined &&
      startInstant <= now &&
      now <= endInstant,
  };
}

function knownValue(fact: ProjectedFact | undefined): unknown {
  return fact?.state === "known" ? fact.value : undefined;
}
function knownString(fact: ProjectedFact | undefined): string | undefined {
  const value = knownValue(fact);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function knownStrings(fact: ProjectedFact | undefined): readonly string[] {
  const value = knownValue(fact);
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}
function knownNumber(fact: ProjectedFact | undefined): number | undefined {
  const value = knownValue(fact);
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
function knownBoolean(fact: ProjectedFact | undefined): boolean | undefined {
  const value = knownValue(fact);
  return typeof value === "boolean" ? value : undefined;
}
function knownDateTime(fact: ProjectedFact | undefined): string | undefined {
  const value = knownString(fact);
  return value !== undefined &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(
      value,
    )
    ? value
    : undefined;
}
function knownStatus(
  fact: ProjectedFact | undefined,
): PublicEvent["status"] | undefined {
  const value = knownString(fact);
  return value === "scheduled" ||
    value === "cancelled" ||
    value === "postponed" ||
    value === "sold_out"
    ? value
    : undefined;
}
function eventDate(
  facts: Readonly<Record<string, ProjectedFact>>,
): string | undefined {
  return (
    knownDateTime(facts["date"]) ??
    dateFor(knownDateTime(facts["start"])) ??
    dateFor(knownDateTime(facts["showtime"])) ??
    dateFor(knownDateTime(facts["end"]))
  );
}
function dateFor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === dateLength || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
    return value.slice(0, dateLength);
  return dateInSaoPaulo(new Date(value));
}
function instantFor(value: string | undefined): Date | undefined {
  if (
    value === undefined ||
    value.length === dateLength ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  )
    return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? undefined : instant;
}
function dateInSaoPaulo(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: saoPaulo,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function compareFuture(left: PublicEvent, right: PublicEvent): number {
  return compareEvents(left, right);
}
function comparePast(left: PublicEvent, right: PublicEvent): number {
  return compareEvents(right, left);
}
function compareEvents(left: PublicEvent, right: PublicEvent): number {
  return (
    left.date.localeCompare(right.date) ||
    (left.start ?? left.showtime ?? "").localeCompare(
      right.start ?? right.showtime ?? "",
    ) ||
    left.title.localeCompare(right.title, "pt-BR")
  );
}
export function publicEventId(internalId: string): string {
  return `evt_${createHash("sha256").update(`event-database:public-event:v1\0${internalId}`).digest().subarray(0, publicIdBytes).toString("base64url")}`;
}
function safeTicketUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
