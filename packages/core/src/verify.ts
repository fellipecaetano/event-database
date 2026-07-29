import { logRecordSchema, type Document, type LogRecord } from "./records.js";

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
  | "missing-artefact"
  | "missing-document"
  | "missing-observation"
  | "ungrounded-span"
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
  const observationIds = new Set<string>();

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
      observationIds.add(record.id);
    }
    if (record.type !== "document") {
      continue;
    }

    documents.set(record.id, record);
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
      record.type === "match" &&
      record.subject.kind === "observation" &&
      !observationIds.has(record.subject.id)
    ) {
      issues.push({
        code: "missing-observation",
        message: `Match references missing Observation ${record.subject.id}`,
        recordId: record.id,
      });
    }
  }

  return issues;
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
  for (const [field, claim] of [
    ...Object.entries(observation.claims),
    ...Object.entries(observation.extras),
  ]) {
    if (claim === undefined) {
      continue;
    }
    for (const span of claim.spans) {
      if (!document.text.includes(span)) {
        issues.push({
          code: "ungrounded-span",
          message: `${field} cites text absent from Document ${document.id}: ${JSON.stringify(span)}`,
          recordId: observation.id,
        });
      }
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
  const entries = [
    { field: "source", metadata: document.source },
    { field: "origin", metadata: document.origin },
    { field: "published_at", metadata: document.published_at },
  ];
  for (const { field, metadata } of entries) {
    if (metadata === undefined) {
      continue;
    }
    for (const span of metadata.spans ?? []) {
      if (!document.text.includes(span)) {
        issues.push({
          code: "ungrounded-span",
          message: `document.${field} cites text absent from Document ${document.id}: ${JSON.stringify(span)}`,
          recordId: document.id,
        });
      }
    }
  }
}
