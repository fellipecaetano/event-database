import type { Document, LogRecord, Observation } from "./records.js";

export interface LogIndex {
  readonly records: readonly LogRecord[];
  readonly documentsById: ReadonlyMap<string, Document>;
  readonly observations: readonly Observation[];
  readonly observationsById: ReadonlyMap<string, Observation>;
  readonly matches: readonly Extract<LogRecord, { type: "match" }>[];
  readonly overrides: readonly Extract<LogRecord, { type: "override" }>[];
  readonly validations: readonly Extract<LogRecord, { type: "validation" }>[];
  readonly redirects: readonly Extract<LogRecord, { type: "redirect" }>[];
}

/** Preserves log order while giving derivation stages one shared lookup surface. */
export function indexLog(records: readonly LogRecord[]): LogIndex {
  const documentsById = new Map<string, Document>();
  const observations: Observation[] = [];
  const observationsById = new Map<string, Observation>();
  const matches: Extract<LogRecord, { type: "match" }>[] = [];
  const overrides: Extract<LogRecord, { type: "override" }>[] = [];
  const validations: Extract<LogRecord, { type: "validation" }>[] = [];
  const redirects: Extract<LogRecord, { type: "redirect" }>[] = [];

  for (const record of records) {
    switch (record.type) {
      case "document":
        documentsById.set(record.id, record);
        break;
      case "observation":
        observations.push(record);
        observationsById.set(record.id, record);
        break;
      case "match":
        matches.push(record);
        break;
      case "override":
        overrides.push(record);
        break;
      case "validation":
        validations.push(record);
        break;
      case "redirect":
        redirects.push(record);
        break;
    }
  }

  return {
    records,
    documentsById,
    observations,
    observationsById,
    matches,
    overrides,
    validations,
    redirects,
  };
}
