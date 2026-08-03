import {
  appendFile as fsAppendFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  realpath,
  truncate,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";

import {
  ArtefactReference,
  hashBytes,
  parseJsonLines,
  type CatalogueDataStore,
  type Document,
  type IngestTransaction,
  type LogRecord,
  type Observation,
} from "@event-database/core";

import {
  CatalogueDataLayout,
  type InboxArtefactLocation,
} from "./catalogue-data-layout.js";

type AppendFile = (path: string, data: string) => Promise<void>;

export interface PendingArtefact extends InboxArtefactLocation {
  readonly hash: string;
  readonly reference: ArtefactReference;
}

export interface PreparedIngestCommit {
  readonly sourcePath: string;
  readonly expectedHash: string;
  readonly document: Document;
  readonly observations: readonly Observation[];
}

export interface InboxArtefactInstallation {
  readonly status: "installed" | "already-present" | "conflict";
  readonly hash: string;
}

interface LocalCatalogueDataOptions {
  readonly appendFile?: AppendFile;
}

/** Owns all filesystem behavior below one catalogue's data directory. */
export class LocalCatalogueData implements CatalogueDataStore {
  private readonly appendFile: AppendFile;

  constructor(
    readonly layout: CatalogueDataLayout,
    options: LocalCatalogueDataOptions = {},
  ) {
    this.appendFile =
      options.appendFile ?? ((path, data) => fsAppendFile(path, data, "utf8"));
  }

  async readLog(): Promise<readonly LogRecord[]> {
    const records: LogRecord[] = [];
    for (const stream of ["documents", "observations", "judgements"] as const) {
      const streamPath = this.layout.streamPath(stream);
      const entries = await readdir(streamPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .toSorted((left, right) => left.name.localeCompare(right.name));
      for (const file of files) {
        const path = join(streamPath, file.name);
        records.push(
          ...parseJsonLines(
            await readFile(path, "utf8"),
            relative(this.layout.repositoryRoot, path),
          ),
        );
      }
    }
    return records;
  }

  async append(records: readonly LogRecord[]): Promise<void> {
    const batches = this.partitionBatches(records);
    await this.appendBatches(batches);
  }

  async artefactHashes(
    documents: readonly Document[],
  ): Promise<ReadonlyMap<string, string>> {
    const hashes = new Map<string, string>();
    for (const document of documents) {
      const reference = ArtefactReference.parse(document.artefact);
      try {
        await this.assertSafeArtefactDirectory();
        const path = this.layout.artefactPath(reference);
        await assertRegularFile(path);
        hashes.set(document.artefact, hashBytes(await readFile(path)));
      } catch (error) {
        if (isMissingPath(error)) {
          continue;
        }
        throw error;
      }
    }
    return hashes;
  }

  async pendingArtefacts(
    heldHashes: ReadonlySet<string>,
  ): Promise<readonly PendingArtefact[]> {
    const inbox = this.layout.inboxDirectory();
    await this.assertSafeInboxDirectory();
    const entries = await readdir(inbox, { withFileTypes: true });
    const pending: PendingArtefact[] = [];
    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isFile() || entry.name.startsWith(".")) {
        continue;
      }
      const location = this.layout.assertInboxFile(
        this.layout.inboxPath(entry.name),
      );
      await this.assertSafeInboxFile(location.path);
      const hash = hashBytes(await readFile(location.path));
      if (!heldHashes.has(hash)) {
        pending.push({
          ...location,
          hash,
          reference: ArtefactReference.retained(location.filename),
        });
      }
    }
    return pending;
  }

  async inspectInboxArtefact(path: string): Promise<PendingArtefact> {
    const location = this.layout.assertInboxFile(path);
    await this.assertSafeInboxFile(location.path);
    const hash = hashBytes(await readFile(location.path));
    return {
      ...location,
      hash,
      reference: ArtefactReference.retained(location.filename),
    };
  }

  async installInboxArtefact(
    filename: string,
    contents: AsyncIterable<Uint8Array>,
  ): Promise<InboxArtefactInstallation> {
    const destination = this.layout.inboxPath(filename);
    const temporary = join(
      this.layout.inboxDirectory(),
      `.${randomUUID()}.download`,
    );
    await this.assertSafeInboxDirectory();
    try {
      const file = await open(temporary, "wx");
      const hasher = createHash("sha256");
      try {
        for await (const chunk of contents) {
          hasher.update(chunk);
          await file.write(chunk);
        }
      } finally {
        await file.close();
      }
      const hash = hasher.digest("hex");
      try {
        await link(temporary, destination);
        return { status: "installed", hash };
      } catch (error) {
        if (!isExistingPath(error)) {
          throw error;
        }
        await this.assertSafeInboxFile(destination);
        const existingHash = hashBytes(await readFile(destination));
        return {
          status: existingHash === hash ? "already-present" : "conflict",
          hash: existingHash,
        };
      }
    } finally {
      await removeFileIfPresent(temporary);
    }
  }

  async beginIngest(input: PreparedIngestCommit): Promise<IngestTransaction> {
    if (input.expectedHash !== input.document.artefact_hash) {
      throw new Error("inbox Artefact hash does not match Document");
    }
    const source = this.layout.assertInboxFile(input.sourcePath);
    await this.assertSafeInboxFile(source.path);
    const reference = ArtefactReference.parse(input.document.artefact);
    const expectedReference = this.layout.retainedArtefact(
      source.filename,
    ).reference;
    if (reference.value !== expectedReference.value) {
      throw new Error(
        `Document Artefact must match inbox filename ${source.filename}`,
      );
    }
    const destination = this.layout.artefactPath(reference);
    await assertPathAbsent(destination);
    await this.ensureSafeArtefactDirectory();

    const documentPath = this.layout.logFileFor(input.document);
    const observationPath = this.layout.partitionFile(
      "observations",
      input.document.at,
    );
    const originalSizes = new Map([
      [documentPath, await fileSize(documentPath)],
      [observationPath, await fileSize(observationPath)],
    ]);

    return {
      moveArtefact: async () => {
        await this.assertSafeInboxFile(source.path);
        const actualHash = hashBytes(await readFile(source.path));
        if (
          input.expectedHash !== input.document.artefact_hash ||
          actualHash !== input.document.artefact_hash
        ) {
          throw new Error("inbox Artefact changed before ingest");
        }
        await assertPathAbsent(destination);
        await this.ensureSafeArtefactDirectory();
        await mkdir(dirname(destination), { recursive: true });
        await rename(source.path, destination);
      },
      appendDocument: async () =>
        this.appendSerialized(documentPath, [input.document]),
      appendObservations: async () =>
        this.appendSerialized(observationPath, input.observations),
      rollbackAppends: async () => {
        await Promise.all(
          [...originalSizes].map(([path, size]) => restoreFile(path, size)),
        );
      },
      restoreArtefact: async () => {
        await assertRegularFile(destination);
        await rename(destination, source.path);
      },
    };
  }

  private partitionBatches(
    records: readonly LogRecord[],
  ): Map<string, readonly LogRecord[]> {
    const batches = new Map<string, LogRecord[]>();
    for (const record of records) {
      const path = this.layout.logFileFor(record);
      const batch = batches.get(path) ?? [];
      batch.push(record);
      batches.set(path, batch);
    }
    return batches;
  }

  private async assertSafeInboxDirectory(): Promise<void> {
    await assertDirectory(this.layout.inboxDirectory());
  }

  private async assertSafeInboxFile(path: string): Promise<void> {
    await this.assertSafeInboxDirectory();
    const inbox = await realpath(this.layout.inboxDirectory());
    const file = await lstat(path);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new Error(`inbox Artefact must be a regular file: ${path}`);
    }
    const realFile = await realpath(path);
    if (!isWithin(inbox, realFile)) {
      throw new Error(`inbox Artefact must remain inside ${inbox}`);
    }
  }

  private async assertSafeArtefactDirectory(): Promise<void> {
    await assertDirectory(this.layout.artefactDirectory());
  }

  private async ensureSafeArtefactDirectory(): Promise<void> {
    const directory = this.layout.artefactDirectory();
    try {
      await this.assertSafeArtefactDirectory();
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      await mkdir(directory, { recursive: true });
      await this.assertSafeArtefactDirectory();
    }
  }

  private async appendBatches(
    batches: ReadonlyMap<string, readonly LogRecord[]>,
  ): Promise<void> {
    if (batches.size === 0) {
      return;
    }
    const originalSizes = new Map(
      await Promise.all(
        [...batches.keys()].map(
          async (path) => [path, await fileSize(path)] as const,
        ),
      ),
    );
    try {
      for (const path of [...batches.keys()].toSorted()) {
        const records = batches.get(path);
        if (records !== undefined) {
          await this.appendSerialized(path, records);
        }
      }
    } catch (error) {
      await Promise.all(
        [...originalSizes].map(([path, size]) => restoreFile(path, size)),
      );
      throw error;
    }
  }

  private async appendSerialized(
    path: string,
    records: readonly LogRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.appendFile(
      path,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
  }
}

/** Compatibility adapter for callers that still provide a repository root. */
export async function readLog(root: string): Promise<readonly LogRecord[]> {
  return new LocalCatalogueData(new CatalogueDataLayout(root)).readLog();
}

/** Compatibility adapter for callers that still provide a repository root. */
export async function readArtefactHashes(
  root: string,
  documents: readonly Document[],
): Promise<ReadonlyMap<string, string>> {
  return new LocalCatalogueData(new CatalogueDataLayout(root)).artefactHashes(
    documents,
  );
}

/** Compatibility serializer retained for existing append tests. */
export async function appendRecords(
  path: string,
  records: readonly LogRecord[],
  append: AppendFile,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await append(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

/** Compatibility helper retained for existing rollback tests. */
export async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  throw new Error(`Artefact destination already exists: ${path}`);
}

/** Compatibility helper retained for existing rollback tests. */
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Compatibility helper retained for existing rollback tests. */
export async function restoreFile(
  path: string,
  size: number | undefined,
): Promise<void> {
  if (size === undefined) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    return;
  }
  await truncate(path, size);
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isExistingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`storage directory must be a real directory: ${path}`);
  }
}

async function assertRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`retained Artefact must be a regular file: ${path}`);
  }
}

function isWithin(directory: string, path: string): boolean {
  return path === directory || path.startsWith(`${directory}${sep}`);
}
