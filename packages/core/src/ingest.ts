import { createHash } from "node:crypto";

import { z } from "zod";

import {
  claimSchema,
  documentV2Schema,
  observationSchema,
  recordVersions,
  type Document,
  type LogRecord,
  type Observation,
} from "./records.js";

const uuidV7Layout = {
  byteCount: 16,
  timestampBytes: 6,
  versionBits: 0x70,
  counter: {
    maximum: 0xfff,
    randomBytes: 2,
    highByte: 6,
    lowByte: 7,
    highBitShift: 8,
  },
  variant: {
    byte: 8,
    mask: 0x3f,
    bits: 0x80,
  },
} as const;
const byteEncoding = {
  mask: 0xff,
  radix: 0x100,
  nibbleBits: 4,
} as const;
const uuidTextLayout = {
  radix: 16,
  paddedByteLength: 2,
  firstSegmentEnd: 8,
  secondSegmentEnd: 12,
  thirdSegmentEnd: 16,
  fourthSegmentEnd: 20,
} as const;
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
      if (counter === uuidV7Layout.counter.maximum) {
        throw new Error("UUIDv7 counter exhausted within one millisecond");
      }
      counter += 1;
    } else {
      const randomCounter = randomBytes(uuidV7Layout.counter.randomBytes);
      counter =
        ((randomCounter[0] ?? 0) << byteEncoding.nibbleBits) |
        ((randomCounter[1] ?? 0) >> byteEncoding.nibbleBits);
      lastMillisecond = millisecond;
    }

    const bytes = randomBytes(uuidV7Layout.byteCount);
    if (bytes.length !== uuidV7Layout.byteCount) {
      throw new Error("randomBytes returned an invalid byte count");
    }

    let timestamp = millisecond;
    for (let index = uuidV7Layout.timestampBytes - 1; index >= 0; index -= 1) {
      bytes[index] = timestamp & byteEncoding.mask;
      timestamp = Math.floor(timestamp / byteEncoding.radix);
    }
    bytes[uuidV7Layout.counter.highByte] =
      uuidV7Layout.versionBits | (counter >> uuidV7Layout.counter.highBitShift);
    bytes[uuidV7Layout.counter.lowByte] = counter & byteEncoding.mask;
    bytes[uuidV7Layout.variant.byte] =
      ((bytes[uuidV7Layout.variant.byte] ?? 0) & uuidV7Layout.variant.mask) |
      uuidV7Layout.variant.bits;

    return formatUuid(bytes);
  };
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes]
    .map((byte) =>
      byte
        .toString(uuidTextLayout.radix)
        .padStart(uuidTextLayout.paddedByteLength, "0"),
    )
    .join("");
  return [
    hex.slice(0, uuidTextLayout.firstSegmentEnd),
    hex.slice(uuidTextLayout.firstSegmentEnd, uuidTextLayout.secondSegmentEnd),
    hex.slice(uuidTextLayout.secondSegmentEnd, uuidTextLayout.thirdSegmentEnd),
    hex.slice(uuidTextLayout.thirdSegmentEnd, uuidTextLayout.fourthSegmentEnd),
    hex.slice(uuidTextLayout.fourthSegmentEnd),
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
  readonly existingRecords: readonly LogRecord[];
  readonly extractorTrust: Readonly<Record<string, number>>;
  readonly nextId: () => string;
}

interface PreparedIngest {
  readonly document: Extract<
    Document,
    { v: typeof recordVersions.document.current }
  >;
  readonly observations: Observation[];
}

export function prepareIngest(
  input: unknown,
  context: PrepareIngestContext,
): PreparedIngest {
  const existingDocument = context.existingRecords.find(
    (record): record is Document =>
      record.type === "document" &&
      record.artefact_hash === context.artefactHash,
  );
  if (existingDocument !== undefined) {
    throw new Error(
      `refusing to ingest: that Artefact is already Document ${existingDocument.id}`,
    );
  }

  const draft = ingestDraftSchema.parse(input);
  if (!Object.hasOwn(context.extractorTrust, draft.extractor)) {
    throw new Error(`unknown Extractor ${draft.extractor}`);
  }

  const documentId = context.nextId();
  const document = documentV2Schema.parse({
    type: "document",
    id: documentId,
    at: context.at,
    v: recordVersions.document.current,
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
      v: recordVersions.observation,
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
  document: Extract<Document, { v: typeof recordVersions.document.current }>,
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
