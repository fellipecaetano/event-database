import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import type { InboxArtefactInstallation } from "./catalogue-repository.js";

const inboxPrefix = "inbox/";
const maximumFilenameBytes = 255;
const firstPrintableCharacter = 32;
const deleteCharacter = 127;

export interface RemoteInboxObject {
  readonly key: string;
}

export interface DownloadedRemoteInboxObject {
  readonly contents: AsyncIterable<Uint8Array>;
  readonly versionId: string;
}

export interface RemoteInbox {
  readonly list: () => AsyncIterable<RemoteInboxObject>;
  readonly download: (key: string) => Promise<DownloadedRemoteInboxObject>;
  readonly delete: (key: string, versionId: string) => Promise<void>;
}

export interface LocalInbox {
  readonly installInboxArtefact: (
    filename: string,
    contents: AsyncIterable<Uint8Array>,
  ) => Promise<InboxArtefactInstallation>;
}

export interface InboxPullResult {
  readonly pulled: number;
  readonly alreadyPresent: number;
  readonly conflicts: number;
}

export class S3Inbox implements RemoteInbox {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Client,
  ) {}

  async *list(): AsyncIterable<RemoteInboxObject> {
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: inboxPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) {
          yield { key: object.Key };
        }
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken !== undefined);
  }

  async download(key: string): Promise<DownloadedRemoteInboxObject> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!isByteStream(response.Body)) {
      throw new Error(`remote inbox object has no byte stream: ${key}`);
    }
    if (response.VersionId === undefined) {
      throw new Error(`remote inbox object has no version: ${key}`);
    }
    return { contents: response.Body, versionId: response.VersionId };
  }

  async delete(key: string, versionId: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: versionId,
      }),
    );
  }
}

export async function pullInbox(
  remote: RemoteInbox,
  local: LocalInbox,
): Promise<InboxPullResult> {
  let pulled = 0;
  let alreadyPresent = 0;
  let conflicts = 0;
  for await (const object of remote.list()) {
    const filename = inboxFilenameForKey(object.key);
    const downloaded = await remote.download(object.key);
    const installation = await local.installInboxArtefact(
      filename,
      downloaded.contents,
    );
    if (installation.status === "conflict") {
      conflicts += 1;
      continue;
    }
    if (installation.status === "already-present") {
      alreadyPresent += 1;
    } else {
      pulled += 1;
    }
    await remote.delete(object.key, downloaded.versionId);
  }
  return { pulled, alreadyPresent, conflicts };
}

export function inboxFilenameForKey(key: string): string {
  if (!key.startsWith(inboxPrefix)) {
    throw new Error(`invalid remote inbox key: ${key}`);
  }
  const filename = key.slice(inboxPrefix.length);
  if (
    filename.length === 0 ||
    filename.startsWith(".") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    containsControlCharacter(filename) ||
    new TextEncoder().encode(filename).byteLength > maximumFilenameBytes
  ) {
    throw new Error(`invalid remote inbox key: ${key}`);
  }
  return filename;
}

export function s3InboxFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): S3Inbox {
  const bucket = requiredEnvironment(environment, "CATALOGUE_DATA_BUCKET");
  const region = requiredEnvironment(environment, "AWS_REGION");
  return new S3Inbox(bucket, new S3Client({ region }));
}

function isByteStream(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < firstPrintableCharacter || code === deleteCharacter) {
      return true;
    }
  }
  return false;
}
