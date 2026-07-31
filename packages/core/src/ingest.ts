import { z } from "zod";

import { uuidV7Schema } from "./entity-reference.js";
import { documentMetadataSpans, observationClaimSpans } from "./grounding.js";
import { hashText } from "./hashing.js";
import {
  claimSchema,
  documentV2Schema,
  observationSchema,
  recordVersions,
  type Document,
  type LogRecord,
  type Observation,
} from "./records.js";

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

export const reextractionDraftSchema = z
  .object({
    document: uuidV7Schema,
    extractor: z.string().min(1),
    observations: z.array(
      z
        .object({
          supersedes: uuidV7Schema,
          claims: z.record(z.string(), claimSchema),
          extras: z.record(z.string(), claimSchema).default({}),
        })
        .strict(),
    ),
  })
  .strict();

export type ReextractionDraft = z.input<typeof reextractionDraftSchema>;

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

export function prepareReextraction(
  input: unknown,
  context: Pick<
    PrepareIngestContext,
    "at" | "existingRecords" | "extractorTrust" | "nextId"
  >,
): Observation[] {
  const draft = reextractionDraftSchema.parse(input);
  if (!Object.hasOwn(context.extractorTrust, draft.extractor)) {
    throw new Error(`unknown Extractor ${draft.extractor}`);
  }
  const document = context.existingRecords.find(
    (record): record is Document =>
      record.type === "document" && record.id === draft.document,
  );
  if (document === undefined) {
    throw new Error(`missing Document ${draft.document}`);
  }
  const observations = new Map(
    context.existingRecords
      .filter((record): record is Observation => record.type === "observation")
      .map((observation) => [observation.id, observation]),
  );
  return draft.observations.map((replacement) => {
    const previous = observations.get(replacement.supersedes);
    if (previous?.document !== document.id) {
      throw new Error(
        `cannot re-extract missing Observation ${replacement.supersedes} from Document ${document.id}`,
      );
    }
    const record = observationSchema.parse({
      type: "observation",
      id: context.nextId(),
      at: context.at,
      v: recordVersions.observation,
      document: document.id,
      extractor: draft.extractor,
      supersedes: previous.id,
      subject: previous.subject,
      claims: replacement.claims,
      extras: replacement.extras,
    });
    verifyClaimSpans(record, document.text);
    return record;
  });
}

function verifyMetadataSpans(
  document: Extract<Document, { v: typeof recordVersions.document.current }>,
): void {
  for (const { span } of documentMetadataSpans(document)) {
    assertGrounded(span, document.text);
  }
}

function verifyClaimSpans(observation: Observation, text: string): void {
  for (const { span } of observationClaimSpans(observation)) {
    assertGrounded(span, text);
  }
}

function assertGrounded(span: string, text: string): void {
  if (!text.includes(span)) {
    throw new Error(`ungrounded span: ${JSON.stringify(span)}`);
  }
}
