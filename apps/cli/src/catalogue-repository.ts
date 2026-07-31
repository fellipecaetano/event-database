import { readFile, readdir, stat, truncate, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  hashBytes,
  parseJsonLines,
  type Document,
  type LogRecord,
} from "@event-database/core";

export async function readLog(root: string): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  for (const directory of ["documents", "observations", "judgements"]) {
    const path = join(root, "data", directory);
    const entries = await readdir(path, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const file of files) {
      const filePath = join(path, file.name);
      records.push(
        ...parseJsonLines(
          await readFile(filePath, "utf8"),
          relative(root, filePath),
        ),
      );
    }
  }
  return records;
}

export async function readArtefactHashes(
  root: string,
  records: readonly LogRecord[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const document of records.filter(
    (record): record is Document => record.type === "document",
  )) {
    try {
      hashes.set(
        document.artefact,
        hashBytes(await readFile(join(root, document.artefact))),
      );
    } catch (error) {
      if (isMissingPath(error)) {
        continue;
      }
      throw error;
    }
  }
  return hashes;
}

export async function appendRecords(
  path: string,
  records: readonly LogRecord[],
  append: (path: string, data: string) => Promise<void>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await append(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

export async function assertPathAbsent(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  throw new Error(`Artefact destination already exists: ${path}`);
}

export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

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
