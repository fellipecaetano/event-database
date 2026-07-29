import { z } from "zod";

const currencyCodeLength = 3;
const versionOne = 1;
const versionTwo = 2;

const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "expected a UUIDv7",
  );

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
    currency: z.string().length(currencyCodeLength).optional(),
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
    v: z.literal(versionOne),
    source: z.string().min(1),
    origin: z.string().min(1).optional(),
    published_at: z.string().min(1).optional(),
  })
  .strict();

export const documentV2Schema = z
  .object({
    ...documentBase,
    v: z.literal(versionTwo),
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
    title: claimSchema.optional(),
    date: claimSchema.optional(),
    start: claimSchema.optional(),
    showtime: claimSchema.optional(),
    end: claimSchema.optional(),
    venue_name: claimSchema.optional(),
    lineup: claimSchema.optional(),
    genre_words: claimSchema.optional(),
    price_from: claimSchema.optional(),
    tickets_exist: claimSchema.optional(),
    ticket_url: claimSchema.optional(),
    tickets_at_door: claimSchema.optional(),
    status: claimSchema.optional(),
  })
  .strict();

const venueClaimsSchema = z
  .object({
    venue_name: claimSchema.optional(),
    city: claimSchema.optional(),
    address: claimSchema.optional(),
    neighbourhood: claimSchema.optional(),
    opening_hours: claimSchema.optional(),
  })
  .strict();

const observationBase = {
  type: z.literal("observation"),
  id: uuidV7Schema,
  at: appendedAtSchema,
  v: z.literal(versionOne),
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

const typedEntityReferenceSchema = z
  .string()
  .regex(
    /^(event|venue):[0-9a-f-]+$|^source:[a-z0-9][a-z0-9._/-]*$/i,
    "expected a typed entity reference",
  );

const judgementBase = {
  id: uuidV7Schema,
  at: appendedAtSchema,
};

export const matchSchema = z
  .object({
    ...judgementBase,
    type: z.literal("match"),
    v: z.literal(versionOne),
    subject: z.union([
      z.object({ kind: z.literal("observation"), id: uuidV7Schema }).strict(),
      z
        .object({ kind: z.literal("venue-name"), value: z.string().min(1) })
        .strict(),
    ]),
    entity: typedEntityReferenceSchema,
    verdict: z.enum(["same", "different", "deferred"]),
    by: z.string().min(1),
    score: z.number().min(0).max(1).optional(),
    proposed: z.boolean().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const overrideSchema = z
  .object({
    ...judgementBase,
    type: z.literal("override"),
    v: z.literal(versionOne),
    entity: typedEntityReferenceSchema,
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
    v: z.literal(versionTwo),
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
          entity: typedEntityReferenceSchema,
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
    v: z.literal(versionOne),
    from: typedEntityReferenceSchema,
    to: typedEntityReferenceSchema,
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
