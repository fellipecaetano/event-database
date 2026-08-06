import { z } from "zod";

import { entityReferenceSchema, uuidV7Schema } from "./entity-reference.js";

const currencyCodeLength = 3;
export const recordVersions = {
  document: { legacy: 1, current: 2 },
  observation: 1,
  match: 1,
  override: 1,
  validation: 2,
  redirect: 1,
} as const;

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "expected a SHA-256 digest");

const appendedAtSchema = z.iso.datetime({ offset: true });
const nonEmptySpansSchema = z.array(z.string().min(1)).min(1);
const jsonValueSchema = z.json();

const statedClaimSchema = z
  .object({
    value: jsonValueSchema,
    spans: nonEmptySpansSchema,
    rule: z.string().min(1).optional(),
    currency: z
      .string()
      .regex(new RegExp(`^[A-Za-z]{${String(currencyCodeLength)}}$`, "u"))
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .strict();

const unknownClaimSchema = z
  .object({
    unknown: z.literal(true),
    spans: nonEmptySpansSchema,
    rule: z.string().min(1).optional(),
  })
  .strict();

export const claimSchema = z.union([statedClaimSchema, unknownClaimSchema]);

type JsonValueOutput = z.output<typeof jsonValueSchema>;
type UnknownClaim = z.output<typeof unknownClaimSchema>;
type StatedClaim<Value extends JsonValueOutput> = Omit<
  z.output<typeof statedClaimSchema>,
  "value"
> & { readonly value: Value };

function typedClaimSchema<Value extends JsonValueOutput>(
  value: z.ZodType<Value>,
): z.ZodType<StatedClaim<Value> | UnknownClaim> {
  return z.union([statedClaimSchema.extend({ value }), unknownClaimSchema]);
}

const stringClaimSchema = typedClaimSchema(z.string().min(1));
const stringArrayClaimSchema = typedClaimSchema(
  z.array(z.string().min(1)).min(1),
);
const dateClaimSchema = typedClaimSchema(z.iso.date());
const localOrOffsetDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u,
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "expected a datetime");
const dateTimeClaimSchema = typedClaimSchema(
  z.union([z.iso.date(), localOrOffsetDateTimeSchema]),
);
const moneyClaimSchema = typedClaimSchema(z.number().nonnegative());
const booleanClaimSchema = typedClaimSchema(z.boolean());
const urlClaimSchema = typedClaimSchema(z.url());
const statusClaimSchema = typedClaimSchema(
  z.enum(["scheduled", "cancelled", "postponed", "sold_out"]),
);

const groundedMetadataSchema = z
  .object({
    value: z.string().min(1),
    spans: nonEmptySpansSchema.optional(),
    supplied_by: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    ({ spans, supplied_by: suppliedBy }) =>
      spans !== undefined || suppliedBy !== undefined,
    { message: "metadata needs spans or supplied_by" },
  );

const documentBase = {
  type: z.literal("document"),
  id: uuidV7Schema,
  at: appendedAtSchema,
  retrieved_at: appendedAtSchema,
  text_source: z.enum(["retrieved", "converted", "transcribed"]),
  artefact: z.string().min(1),
  artefact_hash: sha256Schema,
  text_hash: sha256Schema,
  text: z.string(),
};

export const documentV1Schema = z
  .object({
    ...documentBase,
    v: z.literal(recordVersions.document.legacy),
    source: z.string().min(1),
    origin: z.string().min(1).optional(),
    published_at: z.string().min(1).optional(),
  })
  .strict();

export const documentV2Schema = z
  .object({
    ...documentBase,
    v: z.literal(recordVersions.document.current),
    source: groundedMetadataSchema,
    origin: groundedMetadataSchema.optional(),
    published_at: groundedMetadataSchema.optional(),
  })
  .strict();

export const documentSchema = z.discriminatedUnion("v", [
  documentV1Schema,
  documentV2Schema,
]);

const eventClaimsSchema = z
  .object({
    title: stringClaimSchema.optional(),
    date: dateClaimSchema.optional(),
    start: dateTimeClaimSchema.optional(),
    showtime: dateTimeClaimSchema.optional(),
    end: dateTimeClaimSchema.optional(),
    venue_name: stringClaimSchema.optional(),
    lineup: stringArrayClaimSchema.optional(),
    genre_words: stringArrayClaimSchema.optional(),
    price_from: moneyClaimSchema.optional(),
    tickets_exist: booleanClaimSchema.optional(),
    ticket_url: urlClaimSchema.optional(),
    tickets_at_door: booleanClaimSchema.optional(),
    status: statusClaimSchema.optional(),
  })
  .strict();

const venueClaimsSchema = z
  .object({
    venue_name: stringClaimSchema.optional(),
    city: stringClaimSchema.optional(),
    address: stringClaimSchema.optional(),
    neighbourhood: stringClaimSchema.optional(),
    opening_hours: claimSchema.optional(),
  })
  .strict();

const observationBase = {
  type: z.literal("observation"),
  id: uuidV7Schema,
  at: appendedAtSchema,
  v: z.literal(recordVersions.observation),
  document: uuidV7Schema,
  extractor: z.string().min(1),
  supersedes: uuidV7Schema.optional(),
  extras: z.record(z.string(), claimSchema).default({}),
};

const eventObservationSchema = z
  .object({
    ...observationBase,
    subject: z.object({ kind: z.literal("event"), id: uuidV7Schema }).strict(),
    claims: eventClaimsSchema,
  })
  .strict();

const venueObservationSchema = z
  .object({
    ...observationBase,
    subject: z.object({ kind: z.literal("venue"), id: uuidV7Schema }).strict(),
    claims: venueClaimsSchema,
  })
  .strict();

export const observationSchema = z.union([
  eventObservationSchema,
  venueObservationSchema,
]);

const judgementBase = {
  id: uuidV7Schema,
  at: appendedAtSchema,
};

export const matchSchema = z
  .object({
    ...judgementBase,
    type: z.literal("match"),
    v: z.literal(recordVersions.match),
    subject: z.union([
      z.object({ kind: z.literal("observation"), id: uuidV7Schema }).strict(),
      z
        .object({ kind: z.literal("venue-name"), value: z.string().min(1) })
        .strict(),
    ]),
    entity: entityReferenceSchema,
    verdict: z.enum(["same", "different", "deferred"]),
    by: z.string().min(1),
    score: z.number().min(0).max(1).optional(),
    proposed: z.boolean().optional(),
    creates_entity: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const overrideSchema = z
  .object({
    ...judgementBase,
    type: z.literal("override"),
    v: z.literal(recordVersions.override),
    entity: entityReferenceSchema,
    field: z.string().min(1),
    value: jsonValueSchema,
    rules: z.string().min(1).optional(),
    by: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export const validationSchema = z
  .object({
    ...judgementBase,
    type: z.literal("validation"),
    v: z.literal(recordVersions.validation),
    target: z.union([
      z
        .object({
          kind: z.enum(["event", "venue"]),
          id: uuidV7Schema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("fact"),
          entity: entityReferenceSchema,
          field: z.string().min(1),
        })
        .strict(),
    ]),
    vouched_for: jsonValueSchema,
    tier: z.enum(["validated", "corroborated", "single-source"]).optional(),
    rules: z.string().min(1),
    by: z.string().min(1),
  })
  .strict();

export const redirectSchema = z
  .object({
    ...judgementBase,
    type: z.literal("redirect"),
    v: z.literal(recordVersions.redirect),
    from: entityReferenceSchema,
    to: entityReferenceSchema,
    reason: z.string().min(1),
  })
  .strict();

export const judgementSchema = z.union([
  matchSchema,
  overrideSchema,
  validationSchema,
  redirectSchema,
]);

export const logRecordSchema = z.union([
  documentSchema,
  observationSchema,
  judgementSchema,
]);

export type Claim = z.infer<typeof claimSchema>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Judgement = z.infer<typeof judgementSchema>;
export type LogRecord = z.infer<typeof logRecordSchema>;

/** The Source name, regardless of which Document version grounded it. */
export function documentSourceName(document: Document): string {
  return document.v === 1 ? document.source : document.source.value;
}
