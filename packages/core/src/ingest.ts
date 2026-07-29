import { createHash } from "node:crypto";

import { z } from "zod";

import {
  claimSchema,
  documentV2Schema,
  observationSchema,
  type Document,
  type Observation,
} from "./records.js";

const timestampByteCount = 6;
const uuidByteCount = 16;
const counterMaximum = 0xfff;
const versionSeven = 0x70;
const variantMask = 0x3f;
const variantBits = 0x80;
const byteMask = 0xff;
const byteRadix = 0x100;
const counterRandomByteCount = 2;
const nibbleBitCount = 4;
const counterHighByteIndex = 6;
const counterLowByteIndex = 7;
const variantByteIndex = 8;
const counterHighBitShift = 8;
const hexRadix = 16;
const paddedHexLength = 2;
const firstSegmentEnd = 8;
const secondSegmentEnd = 12;
const thirdSegmentEnd = 16;
const fourthSegmentEnd = 20;
const documentVersion = 2;
const observationVersion = 1;

interface UuidV7Dependencies {
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}

export function createUuidV7Generator({
  now,
  randomBytes,
}: UuidV7Dependencies): () => string {
  let lastMillisecond = -1;
  let counter = 0;

  return () => {
    const millisecond = Math.floor(now());
    if (millisecond === lastMillisecond) {
      if (counter === counterMaximum) {
        throw new Error("UUIDv7 counter exhausted within one millisecond");
      }
      counter += 1;
    } else {
      const randomCounter = randomBytes(counterRandomByteCount);
      counter =
        ((randomCounter[0] ?? 0) << nibbleBitCount) |
        ((randomCounter[1] ?? 0) >> nibbleBitCount);
      lastMillisecond = millisecond;
    }

    const bytes = randomBytes(uuidByteCount);
    if (bytes.length !== uuidByteCount) {
      throw new Error("randomBytes returned an invalid byte count");
    }

    let timestamp = millisecond;
    for (let index = timestampByteCount - 1; index >= 0; index -= 1) {
      bytes[index] = timestamp & byteMask;
      timestamp = Math.floor(timestamp / byteRadix);
    }
    bytes[counterHighByteIndex] =
      versionSeven | (counter >> counterHighBitShift);
    bytes[counterLowByteIndex] = counter & byteMask;
    bytes[variantByteIndex] =
      ((bytes[variantByteIndex] ?? 0) & variantMask) | variantBits;

    return formatUuid(bytes);
  };
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes]
    .map((byte) => byte.toString(hexRadix).padStart(paddedHexLength, "0"))
    .join("");
  return [
    hex.slice(0, firstSegmentEnd),
    hex.slice(firstSegmentEnd, secondSegmentEnd),
    hex.slice(secondSegmentEnd, thirdSegmentEnd),
    hex.slice(thirdSegmentEnd, fourthSegmentEnd),
    hex.slice(fourthSegmentEnd),
  ].join("-");
}

export function hashText(text: string): string {
  return hashBytes(new TextEncoder().encode(text));
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const ingestDocumentDraftSchema = z
  .object({
    source: documentV2Schema.shape.source,
    origin: documentV2Schema.shape.origin,
    published_at: documentV2Schema.shape.published_at,
    retrieved_at: documentV2Schema.shape.retrieved_at,
    text_source: documentV2Schema.shape.text_source,
    text: documentV2Schema.shape.text,
  })
  .strict();

const observationDraftSchema = z
  .object({
    subject: z.enum(["event", "venue"]),
    claims: z.record(z.string(), claimSchema),
    extras: z.record(z.string(), claimSchema).default({}),
  })
  .strict();

export const ingestDraftSchema = z
  .object({
    document: ingestDocumentDraftSchema,
    extractor: z.string().min(1),
    observations: z.array(observationDraftSchema),
  })
  .strict();

export type IngestDraft = z.input<typeof ingestDraftSchema>;

interface PrepareIngestContext {
  readonly at: string;
  readonly artefact: string;
  readonly artefactHash: string;
  readonly nextId: () => string;
}

interface PreparedIngest {
  readonly document: Extract<Document, { v: typeof documentVersion }>;
  readonly observations: Observation[];
}

export function prepareIngest(
  input: IngestDraft,
  context: PrepareIngestContext,
): PreparedIngest {
  const draft = ingestDraftSchema.parse(input);
  const documentId = context.nextId();
  const document = documentV2Schema.parse({
    type: "document",
    id: documentId,
    at: context.at,
    v: documentVersion,
    ...draft.document,
    artefact: context.artefact,
    artefact_hash: context.artefactHash,
    text_hash: hashText(draft.document.text),
  });

  verifyMetadataSpans(document);

  const observations = draft.observations.map((observation) => {
    const record = observationSchema.parse({
      type: "observation",
      id: context.nextId(),
      at: context.at,
      v: observationVersion,
      document: documentId,
      extractor: draft.extractor,
      subject: {
        kind: observation.subject,
        id: context.nextId(),
      },
      claims: observation.claims,
      extras: observation.extras,
    });
    verifyClaimSpans(record, document.text);
    return record;
  });

  return { document, observations };
}

function verifyMetadataSpans(
  document: Extract<Document, { v: typeof documentVersion }>,
): void {
  for (const metadata of [
    document.source,
    document.origin,
    document.published_at,
  ]) {
    for (const span of metadata?.spans ?? []) {
      assertGrounded(span, document.text);
    }
  }
}

function verifyClaimSpans(observation: Observation, text: string): void {
  for (const claim of [
    ...Object.values(observation.claims),
    ...Object.values(observation.extras),
  ]) {
    if (claim === undefined) {
      continue;
    }
    for (const span of claim.spans) {
      assertGrounded(span, text);
    }
  }
}

function assertGrounded(span: string, text: string): void {
  if (!text.includes(span)) {
    throw new Error(`ungrounded span: ${JSON.stringify(span)}`);
  }
}
