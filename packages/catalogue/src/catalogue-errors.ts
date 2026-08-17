import type { VerificationIssue } from "@event-database/core";

import { deepFreezeCopy } from "./immutable.js";

export class InvalidCatalogueError extends Error {
  readonly issues: readonly VerificationIssue[];

  constructor(issues: readonly VerificationIssue[]) {
    super("catalogue log is invalid");
    this.name = "InvalidCatalogueError";
    this.issues = deepFreezeCopy(issues);
  }
}
