import { join, relative, resolve, sep } from "node:path";

import { ArtefactReference, type LogRecord } from "@event-database/core";

export type LogStream = "documents" | "observations" | "judgements";

export interface InboxArtefactLocation {
  readonly path: string;
  readonly filename: string;
  readonly repositoryRelativePath: string;
}

export interface RetainedArtefactLocation {
  readonly reference: ArtefactReference;
  readonly path: string;
}

const monthPartitionLength = 7;

/** Owns the portable-to-local mapping for one catalogue repository. */
export class CatalogueDataLayout {
  readonly dataRoot: string;

  constructor(readonly repositoryRoot: string) {
    this.dataRoot = join(repositoryRoot, "data");
  }

  streamFor(record: LogRecord): LogStream {
    switch (record.type) {
      case "document":
        return "documents";
      case "observation":
        return "observations";
      case "match":
      case "override":
      case "validation":
      case "redirect":
        return "judgements";
    }
    throw new Error("unsupported record type");
  }

  logFileFor(record: LogRecord): string {
    return this.partitionFile(this.streamFor(record), record.at);
  }

  streamPath(stream: LogStream): string {
    return join(this.dataRoot, stream);
  }

  partitionFile(stream: LogStream, at: string): string {
    return join(
      this.dataRoot,
      stream,
      `${at.slice(0, monthPartitionLength)}.jsonl`,
    );
  }

  artefactPath(reference: ArtefactReference): string {
    return join(this.dataRoot, reference.objectKey);
  }

  retainedArtefact(filename: string): RetainedArtefactLocation {
    const reference = ArtefactReference.retained(filename);
    return { reference, path: this.artefactPath(reference) };
  }

  inboxPath(filename: string): string {
    if (
      filename.length === 0 ||
      filename === "." ||
      filename === ".." ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\u0000")
    ) {
      throw new Error(`invalid inbox filename: ${filename}`);
    }
    return join(this.dataRoot, "inbox", filename);
  }

  inboxDirectory(): string {
    return join(this.dataRoot, "inbox");
  }

  artefactDirectory(): string {
    return join(this.dataRoot, "artefacts");
  }

  assertInboxFile(inputPath: string): InboxArtefactLocation {
    const path = resolve(this.repositoryRoot, inputPath);
    const inbox = resolve(this.dataRoot, "inbox");
    const fromInbox = relative(inbox, path);
    if (
      fromInbox.length === 0 ||
      fromInbox.startsWith(`..${sep}`) ||
      fromInbox === ".." ||
      resolve(inbox, fromInbox) !== path
    ) {
      throw new Error(`Artefact must be inside ${inbox}`);
    }
    if (fromInbox.includes(sep)) {
      throw new Error(`Artefact must be directly inside ${inbox}`);
    }
    return {
      path,
      filename: fromInbox,
      repositoryRelativePath: relative(this.repositoryRoot, path),
    };
  }
}
