import { foldFromIndex, type Catalogue, type FoldOptions } from "./fold.js";
import { indexLog, type LogIndex } from "./log-index.js";
import type { LogRecord } from "./records.js";

/** Immutable derivation shared by a single review queue and its cases. */
export interface ReviewWorkspace {
  readonly index: LogIndex;
  readonly catalogue: Catalogue;
  readonly options: FoldOptions;
}

export function createReviewWorkspace(
  records: readonly LogRecord[],
  options: FoldOptions,
): ReviewWorkspace {
  const index = indexLog(records);
  return {
    index,
    catalogue: foldFromIndex(index, options),
    options,
  };
}
