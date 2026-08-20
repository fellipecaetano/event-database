import {
  buildRedirects,
  type Confidence as CoreConfidence,
  type JsonValue as CoreJsonValue,
  type ProjectedEntity,
  type ProjectedFact,
  resolveRedirect,
} from "@event-database/core";

export { InvalidCatalogueError } from "./catalogue-errors.js";
import { deepFreezeCopy } from "./immutable.js";
import { openCatalogueContext } from "./open-context.js";

export type Confidence = CoreConfidence;
export type JsonValue = CoreJsonValue;

export interface OpenCatalogueOptions {
  readonly repositoryRoot: string;
  readonly at: Date;
}

export interface CatalogueStore {
  readonly asOf: string;
  readonly events: CatalogueCollection<CatalogueEvent>;
  readonly venues: CatalogueCollection<CatalogueVenue>;
}

export interface CatalogueCollection<Entity extends CatalogueEntity> {
  all(): readonly Entity[];
  get(id: string): Entity | undefined;
}

export interface CatalogueEntity {
  readonly id: string;
  readonly observationIds: readonly string[];
  readonly staleValidationIds: readonly string[];
  rawFact(name: string): CatalogueFact<JsonValue> | undefined;
  readonly extras: CatalogueExtraFacts;
}

export interface CatalogueExtraFacts {
  get(name: string): CatalogueFact<JsonValue> | undefined;
  entries(): readonly (readonly [string, CatalogueFact<JsonValue>])[];
}

export interface CatalogueEvent extends CatalogueEntity {
  readonly kind: "event";
  readonly facts: EventFacts;
}

export interface CatalogueVenue extends CatalogueEntity {
  readonly kind: "venue";
  readonly facts: VenueFacts;
}

export type CatalogueFact<Value> =
  | {
      readonly state: "known";
      readonly value: Value;
      readonly currency?: string;
      readonly confidence: Confidence;
      readonly evidence: readonly string[];
    }
  | {
      readonly state: "unknown";
      readonly confidence: Confidence;
      readonly evidence: readonly string[];
    };

export const CatalogueFact = {
  valueIfKnown<Value>(fact?: CatalogueFact<Value>): Value | undefined {
    if (fact !== undefined && fact.state === "known") {
      return fact.value;
    } else {
      return undefined;
    }
  },
};

export interface EventFacts {
  readonly existence: CatalogueFact<boolean>;
  readonly title?: CatalogueFact<string>;
  readonly date?: CatalogueFact<string>;
  readonly start?: CatalogueFact<string>;
  readonly showtime?: CatalogueFact<string>;
  readonly end?: CatalogueFact<string>;
  readonly venueName?: CatalogueFact<string>;
  readonly lineup?: CatalogueFact<readonly string[]>;
  readonly genreWords?: CatalogueFact<readonly string[]>;
  readonly priceFrom?: CatalogueFact<number>;
  readonly ticketsExist?: CatalogueFact<boolean>;
  readonly ticketUrl?: CatalogueFact<string>;
  readonly ticketsAtDoor?: CatalogueFact<boolean>;
  readonly status?: CatalogueFact<
    "scheduled" | "cancelled" | "postponed" | "sold_out"
  >;
}

export interface VenueFacts {
  readonly existence: CatalogueFact<boolean>;
  readonly venueName?: CatalogueFact<string>;
  readonly city?: CatalogueFact<string>;
  readonly address?: CatalogueFact<string>;
  readonly neighbourhood?: CatalogueFact<string>;
  readonly openingHours?: CatalogueFact<JsonValue>;
}

export function openCatalogue({
  repositoryRoot,
  at,
}: OpenCatalogueOptions): Promise<CatalogueStore> {
  return openCatalogueAt(repositoryRoot, at);
}

async function openCatalogueAt(
  repositoryRoot: string,
  at: Date,
): Promise<CatalogueStore> {
  const { index, projection } = await openCatalogueContext({
    repositoryRoot,
    at,
  });
  const redirects = buildRedirects(index);

  const events = projection.events.map((entity) => adaptEvent(entity));
  const venues = projection.venues.map((entity) => adaptVenue(entity));
  return Object.freeze({
    asOf: projection.asOf,
    events: collection("event", events, redirects),
    venues: collection("venue", venues, redirects),
  });
}

function adaptEvent(entity: ProjectedEntity): CatalogueEvent {
  const rawFacts = adaptFacts(entity.facts);
  const title = typedFact(rawFacts, "title", isString);
  const date = typedFact(rawFacts, "date", isString);
  const start = typedFact(rawFacts, "start", isString);
  const showtime = typedFact(rawFacts, "showtime", isString);
  const end = typedFact(rawFacts, "end", isString);
  const venueName = typedFact(rawFacts, "venue_name", isString);
  const lineup = typedFact(rawFacts, "lineup", isStringArray);
  const genreWords = typedFact(rawFacts, "genre_words", isStringArray);
  const priceFrom = typedFact(rawFacts, "price_from", isNumber);
  const ticketsExist = typedFact(rawFacts, "tickets_exist", isBoolean);
  const ticketUrl = typedFact(rawFacts, "ticket_url", isString);
  const ticketsAtDoor = typedFact(rawFacts, "tickets_at_door", isBoolean);
  const status = typedFact(rawFacts, "status", isStatus);
  return Object.freeze({
    ...adaptEntity(entity, rawFacts),
    kind: "event" as const,
    facts: Object.freeze({
      existence: requiredFact(rawFacts, "existence", isBoolean),
      ...(title === undefined ? {} : { title }),
      ...(date === undefined ? {} : { date }),
      ...(start === undefined ? {} : { start }),
      ...(showtime === undefined ? {} : { showtime }),
      ...(end === undefined ? {} : { end }),
      ...(venueName === undefined ? {} : { venueName }),
      ...(lineup === undefined ? {} : { lineup }),
      ...(genreWords === undefined ? {} : { genreWords }),
      ...(priceFrom === undefined ? {} : { priceFrom }),
      ...(ticketsExist === undefined ? {} : { ticketsExist }),
      ...(ticketUrl === undefined ? {} : { ticketUrl }),
      ...(ticketsAtDoor === undefined ? {} : { ticketsAtDoor }),
      ...(status === undefined ? {} : { status }),
    }),
  });
}

function adaptVenue(entity: ProjectedEntity): CatalogueVenue {
  const rawFacts = adaptFacts(entity.facts);
  const venueName = typedFact(rawFacts, "venue_name", isString);
  const city = typedFact(rawFacts, "city", isString);
  const address = typedFact(rawFacts, "address", isString);
  const neighbourhood = typedFact(rawFacts, "neighbourhood", isString);
  const openingHours = typedFact(rawFacts, "opening_hours", isJsonValue);
  return Object.freeze({
    ...adaptEntity(entity, rawFacts),
    kind: "venue" as const,
    facts: Object.freeze({
      existence: requiredFact(rawFacts, "existence", isBoolean),
      ...(venueName === undefined ? {} : { venueName }),
      ...(city === undefined ? {} : { city }),
      ...(address === undefined ? {} : { address }),
      ...(neighbourhood === undefined ? {} : { neighbourhood }),
      ...(openingHours === undefined ? {} : { openingHours }),
    }),
  });
}

function adaptEntity(
  entity: ProjectedEntity,
  rawFacts: Readonly<Record<string, CatalogueFact<JsonValue>>>,
): Omit<CatalogueEntity, "extras"> & { readonly extras: CatalogueExtraFacts } {
  return {
    id: entity.id,
    observationIds: deepFreezeCopy(entity.observationIds),
    staleValidationIds: deepFreezeCopy(entity.staleValidationIds),
    rawFact: (name) => rawFacts[name],
    extras: extraFacts(adaptFacts(entity.extras)),
  };
}

function adaptFacts(
  facts: Readonly<Record<string, ProjectedFact>>,
): Readonly<Record<string, CatalogueFact<JsonValue>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(facts).map(([name, fact]) => [name, adaptFact(fact)]),
    ),
  );
}

function adaptFact(fact: ProjectedFact): CatalogueFact<JsonValue> {
  if (fact.state === "unknown") {
    return Object.freeze({
      state: "unknown",
      confidence: fact.confidence,
      evidence: deepFreezeCopy(fact.evidence),
    });
  }
  return Object.freeze({
    state: "known",
    value: deepFreezeCopy(fact.value),
    ...(fact.currency === undefined ? {} : { currency: fact.currency }),
    confidence: fact.confidence,
    evidence: deepFreezeCopy(fact.evidence),
  });
}

function extraFacts(
  facts: Readonly<Record<string, CatalogueFact<JsonValue>>>,
): CatalogueExtraFacts {
  const entries = Object.freeze(
    Object.entries(facts)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, fact]) => Object.freeze([name, fact] as const)),
  );
  return Object.freeze({
    get: (name: string) => facts[name],
    entries: () => entries,
  });
}

function collection<Entity extends CatalogueEntity>(
  kind: "event" | "venue",
  entities: readonly Entity[],
  redirects: ReadonlyMap<string, string>,
): CatalogueCollection<Entity> {
  const all = Object.freeze([...entities]);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  return Object.freeze({
    all: () => all,
    get: (id: string) => {
      const reference = resolveRedirect(`${kind}:${id}`, redirects);
      return byId.get(reference.slice(kind.length + 1));
    },
  });
}

function typedFact<Value extends JsonValue>(
  facts: Readonly<Record<string, CatalogueFact<JsonValue>>>,
  name: string,
  accepts: (value: JsonValue) => value is Value,
): CatalogueFact<Value> | undefined {
  const fact = facts[name];
  if (fact === undefined || (fact.state === "known" && !accepts(fact.value))) {
    return undefined;
  }
  return fact as CatalogueFact<Value>;
}

function requiredFact<Value extends JsonValue>(
  facts: Readonly<Record<string, CatalogueFact<JsonValue>>>,
  name: string,
  accepts: (value: JsonValue) => value is Value,
): CatalogueFact<Value> {
  const fact = typedFact(facts, name, accepts);
  if (fact === undefined) {
    throw new Error(`Fold invariant failed: missing or malformed ${name}`);
  }
  return fact;
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue): value is number {
  return typeof value === "number";
}

function isBoolean(value: JsonValue): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: JsonValue): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isStatus(
  value: JsonValue,
): value is "scheduled" | "cancelled" | "postponed" | "sold_out" {
  return (
    value === "scheduled" ||
    value === "cancelled" ||
    value === "postponed" ||
    value === "sold_out"
  );
}

function isJsonValue(_value: JsonValue): _value is JsonValue {
  return true;
}
