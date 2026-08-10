import { parseEntityReference } from "./entity-reference.js";
import { documentMetadataSpans, observationClaimSpans } from "./grounding.js";
import { hashText } from "./hashing.js";
import { sourceTrustProfiles } from "./source-trust.js";
import {
  logRecordSchema,
  type Document,
  type LogRecord,
  type Observation,
} from "./records.js";

const groundedMetadataVersion = 2;

export class LogParseError extends Error {
  constructor(
    readonly path: string,
    readonly line: number,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`${path}:${String(line)}: ${detail}`, options);
    this.name = "LogParseError";
  }
}

export function parseJsonLines(text: string, path: string): LogRecord[] {
  return text.split("\n").flatMap((line, index) => {
    if (line.trim().length === 0) {
      return [];
    }

    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new LogParseError(path, lineNumber, "invalid JSON", {
        cause: error,
      });
    }

    const result = logRecordSchema.safeParse(value);
    if (!result.success) {
      const recordType = getRecordType(value);
      throw new LogParseError(
        path,
        lineNumber,
        `invalid ${recordType} record: ${result.error.issues[0]?.message ?? "unknown schema error"}`,
        { cause: result.error },
      );
    }

    return [result.data];
  });
}

function getRecordType(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  ) {
    return value.type;
  }
  return "log";
}

export type VerificationIssueCode =
  | "artefact-hash-mismatch"
  | "duplicate-artefact"
  | "duplicate-record-id"
  | "incompatible-entity-reference"
  | "incompatible-supersession"
  | "invalid-entity-creation"
  | "missing-artefact"
  | "missing-document"
  | "missing-entity"
  | "missing-observation"
  | "missing-superseded-observation"
  | "text-hash-mismatch"
  | "ungrounded-span"
  | "unknown-source-kind"
  | "unknown-extractor";

export interface VerificationIssue {
  readonly code: VerificationIssueCode;
  readonly message: string;
  readonly recordId: string;
}

export interface VerifyLogOptions {
  readonly artefactHashes?: ReadonlyMap<string, string>;
  readonly knownExtractors?: ReadonlySet<string>;
}

export function verifyLog(
  records: readonly LogRecord[],
  options: VerifyLogOptions = {},
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const recordIds = new Set<string>();
  const documents = new Map<string, Document>();
  const artefacts = new Map<string, string>();
  const observations = new Map<string, Observation>();
  const entities = new Set<string>();

  for (const record of records) {
    if (recordIds.has(record.id)) {
      issues.push({
        code: "duplicate-record-id",
        message: `record id ${record.id} occurs more than once`,
        recordId: record.id,
      });
    }
    recordIds.add(record.id);

    if (record.type === "observation") {
      observations.set(record.id, record);
      entities.add(`${record.subject.kind}:${record.subject.id}`);
    }
    if (record.type !== "document") {
      continue;
    }

    documents.set(record.id, record);
    const source = record.v === 1 ? record.source : record.source.value;
    entities.add(`source:${source}`);
    const existingDocument = artefacts.get(record.artefact_hash);
    if (existingDocument !== undefined) {
      issues.push({
        code: "duplicate-artefact",
        message: `artefact hash is already held by Document ${existingDocument}`,
        recordId: record.id,
      });
    } else {
      artefacts.set(record.artefact_hash, record.id);
    }
    verifyDocumentMetadataSpans(record, issues);
    verifyArtefact(record, options.artefactHashes, issues);
    if (hashText(record.text) !== record.text_hash) {
      issues.push({
        code: "text-hash-mismatch",
        message: `Document text differs from text_hash`,
        recordId: record.id,
      });
    }
  }

  for (const record of records) {
    if (record.type !== "observation") {
      continue;
    }

    const document = documents.get(record.document);
    if (document === undefined) {
      issues.push({
        code: "missing-document",
        message: `Observation references missing Document ${record.document}`,
        recordId: record.id,
      });
    } else {
      verifyObservationSpans(record, document, issues);
    }

    if (
      record.supersedes !== undefined &&
      !observations.has(record.supersedes)
    ) {
      issues.push({
        code: "missing-superseded-observation",
        message: `Observation supersedes missing Observation ${record.supersedes}`,
        recordId: record.id,
      });
    } else if (record.supersedes !== undefined) {
      const parent = observations.get(record.supersedes);
      if (
        parent !== undefined &&
        (parent.document !== record.document ||
          parent.subject.kind !== record.subject.kind ||
          parent.subject.id !== record.subject.id)
      ) {
        issues.push({
          code: "incompatible-supersession",
          message: `superseded Observation must share Document and subject identity`,
          recordId: record.id,
        });
      }
    }

    if (
      options.knownExtractors !== undefined &&
      !options.knownExtractors.has(record.extractor)
    ) {
      issues.push({
        code: "unknown-extractor",
        message: `unknown Extractor ${record.extractor}`,
        recordId: record.id,
      });
    }
  }

  for (const record of records) {
    if (
      record.type === "override" &&
      parseEntityReference(record.entity).kind === "source" &&
      record.field === "kind" &&
      (typeof record.value !== "string" ||
        !Object.hasOwn(sourceTrustProfiles, record.value))
    ) {
      issues.push({
        code: "unknown-source-kind",
        message: `source kind must be one of ${Object.keys(sourceTrustProfiles).join(", ")}`,
        recordId: record.id,
      });
    }
    if (
      record.type === "match" &&
      record.creates_entity === true &&
      record.subject.kind === "observation" &&
      record.verdict === "same"
    ) {
      if (entities.has(record.entity)) {
        issues.push({
          code: "invalid-entity-creation",
          message: `created entity already exists: ${record.entity}`,
          recordId: record.id,
        });
      } else {
        entities.add(record.entity);
      }
    }
  }

  for (const record of records) {
    if (
      record.type === "match" &&
      record.subject.kind === "observation" &&
      !observations.has(record.subject.id)
    ) {
      issues.push({
        code: "missing-observation",
        message: `Match references missing Observation ${record.subject.id}`,
        recordId: record.id,
      });
    }
    verifyEntityReferences(record, observations, entities, issues);
  }

  return issues;
}

function verifyEntityReferences(
  record: LogRecord,
  observations: ReadonlyMap<string, Observation>,
  entities: ReadonlySet<string>,
  issues: VerificationIssue[],
): void {
  if (record.type === "match") {
    const target = parseEntityReference(record.entity);
    const observation =
      record.subject.kind === "observation"
        ? observations.get(record.subject.id)
        : undefined;
    const expectedKind =
      record.subject.kind === "venue-name"
        ? "venue"
        : observation?.subject.kind;
    if (expectedKind !== undefined && target.kind !== expectedKind) {
      issues.push({
        code: "incompatible-entity-reference",
        message: `Match target must be a ${expectedKind}`,
        recordId: record.id,
      });
    }
    if (record.creates_entity === true) {
      if (
        record.subject.kind !== "observation" ||
        record.verdict !== "same" ||
        observation === undefined
      ) {
        issues.push({
          code: "invalid-entity-creation",
          message: "only a same Observation Match may create an entity",
          recordId: record.id,
        });
      }
    } else if (!entities.has(record.entity)) {
      issues.push({
        code: "missing-entity",
        message: `Match references missing entity ${record.entity}`,
        recordId: record.id,
      });
    }
    return;
  }

  let references: string[] = [];
  if (record.type === "override") {
    references = [record.entity];
  } else if (record.type === "redirect") {
    references = [record.from, record.to];
    if (
      parseEntityReference(record.from).kind !==
      parseEntityReference(record.to).kind
    ) {
      issues.push({
        code: "incompatible-entity-reference",
        message: "Redirect endpoints must have the same kind",
        recordId: record.id,
      });
    }
  } else if (record.type === "validation") {
    references =
      record.target.kind === "fact"
        ? [record.target.entity]
        : [`${record.target.kind}:${record.target.id}`];
  }
  for (const reference of references) {
    if (!entities.has(reference)) {
      issues.push({
        code: "missing-entity",
        message: `${record.type} references missing entity ${reference}`,
        recordId: record.id,
      });
    }
  }
}

function verifyArtefact(
  document: Document,
  artefactHashes: ReadonlyMap<string, string> | undefined,
  issues: VerificationIssue[],
): void {
  if (artefactHashes === undefined) {
    return;
  }
  const actualHash = artefactHashes.get(document.artefact);
  if (actualHash === undefined) {
    issues.push({
      code: "missing-artefact",
      message: `retained Artefact does not exist: ${document.artefact}`,
      recordId: document.id,
    });
  } else if (actualHash !== document.artefact_hash) {
    issues.push({
      code: "artefact-hash-mismatch",
      message: `retained Artefact hash differs: ${document.artefact}`,
      recordId: document.id,
    });
  }
}

function verifyObservationSpans(
  observation: Extract<LogRecord, { type: "observation" }>,
  document: Document,
  issues: VerificationIssue[],
): void {
  for (const { field, span } of observationClaimSpans(observation)) {
    if (!document.text.includes(span)) {
      issues.push({
        code: "ungrounded-span",
        message: `${field} cites text absent from Document ${document.id}: ${JSON.stringify(span)}`,
        recordId: observation.id,
      });
    }
  }
}

function verifyDocumentMetadataSpans(
  document: Document,
  issues: VerificationIssue[],
): void {
  if (document.v !== groundedMetadataVersion) {
    return;
  }
  verifyGroundedMetadataSpans(document, issues);
}

function verifyGroundedMetadataSpans(
  document: Extract<Document, { v: typeof groundedMetadataVersion }>,
  issues: VerificationIssue[],
): void {
  for (const { field, span } of documentMetadataSpans(document)) {
    if (!document.text.includes(span)) {
      issues.push({
        code: "ungrounded-span",
        message: `document.${field} cites text absent from Document ${document.id}: ${JSON.stringify(span)}`,
        recordId: document.id,
      });
    }
  }
}
