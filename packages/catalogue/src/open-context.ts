import {
  createProductionFoldRules,
  foldFromIndex,
  indexLog,
  knownExtractorsFor,
  verifyLog,
  type Catalogue,
  type FoldRules,
  type LogIndex,
  type LogRecord,
} from "@event-database/core";

import { InvalidCatalogueError } from "./catalogue-errors.js";
import type { OpenCatalogueOptions } from "./index.js";
import { CatalogueDataDirectory } from "./maintenance.js";

export interface OpenCatalogueContext {
  readonly records: readonly LogRecord[];
  readonly rules: FoldRules;
  readonly index: LogIndex;
  readonly projection: Catalogue;
  readonly at: Date;
}

export async function openCatalogueContext({
  repositoryRoot,
  at,
}: OpenCatalogueOptions): Promise<OpenCatalogueContext> {
  const milliseconds = at.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError("at must be a valid Date");
  }
  const snapshotAt = new Date(milliseconds);
  const records = await new CatalogueDataDirectory(repositoryRoot).readLog();
  const rules = createProductionFoldRules();
  const issues = verifyLog(records, {
    knownExtractors: knownExtractorsFor(rules),
  });
  if (issues.length > 0) {
    throw new InvalidCatalogueError(issues);
  }
  const index = indexLog(records);
  return {
    records,
    rules,
    index,
    projection: foldFromIndex(index, { now: snapshotAt, rules }),
    at: snapshotAt,
  };
}
