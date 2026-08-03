import { z } from "zod";

import { parseUploadIntent } from "./upload-contract.js";

const uploadConcurrency = 3;
const collisionStatus = 412;
const successfulStatusMinimum = 200;
const successfulStatusMaximum = 300;

const uploadResponseSchema = z.object({
  uploads: z.array(
    z.object({
      name: z.string(),
      url: z.url(),
      headers: z.object({
        "Content-Type": z.string(),
        "If-None-Match": z.literal("*"),
      }),
    }),
  ),
});

export type UploadStatus =
  "queued" | "uploading" | "succeeded" | "collision" | "failed";

export interface UploadUpdate {
  readonly name: string;
  readonly status: UploadStatus;
  readonly progress?: number;
}

export interface SignedUpload {
  readonly name: string;
  readonly url: string;
  readonly headers: {
    readonly "Content-Type": string;
    readonly "If-None-Match": "*";
  };
}

export interface UploadService {
  readonly createIntents: (
    files: readonly File[],
    accessToken: string,
  ) => Promise<{ readonly uploads: readonly SignedUpload[] }>;
  readonly putFile: (
    file: File,
    upload: SignedUpload,
    onProgress: (progress: number) => void,
  ) => Promise<void>;
}

export class UploadCollisionError extends Error {
  constructor() {
    super("An inbox file already uses this name.");
  }
}

export async function uploadFiles(
  files: readonly File[],
  accessToken: string,
  service: UploadService,
  onUpdate: (update: UploadUpdate) => void,
): Promise<void> {
  if (files.length === 0) {
    return;
  }
  const intent = parseUploadIntent({
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    })),
  });
  for (const file of intent.files) {
    onUpdate({ name: file.name, status: "queued" });
  }

  let response: { readonly uploads: readonly SignedUpload[] };
  try {
    response = await service.createIntents(files, accessToken);
  } catch {
    for (const file of intent.files) {
      onUpdate({ name: file.name, status: "failed" });
    }
    return;
  }

  const uploads = new Map(
    response.uploads.map((upload) => [upload.name, upload]),
  );
  let nextFileIndex = 0;
  const workerCount = Math.min(uploadConcurrency, files.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextFileIndex < files.length) {
        const file = files[nextFileIndex];
        nextFileIndex += 1;
        if (file !== undefined) {
          await uploadOne(file, uploads.get(file.name), service, onUpdate);
        }
      }
    }),
  );
}

export function createBrowserUploadService(apiUrl: string): UploadService {
  return {
    createIntents: async (files, accessToken) => {
      const response = await fetch(`${apiUrl}/upload-intents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type || undefined,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error("could not create upload request");
      }
      return uploadResponseSchema.parse(await response.json());
    },
    putFile: putFileWithProgress,
  };
}

async function uploadOne(
  file: File,
  upload: SignedUpload | undefined,
  service: UploadService,
  onUpdate: (update: UploadUpdate) => void,
): Promise<void> {
  if (upload === undefined) {
    onUpdate({ name: file.name, status: "failed" });
    return;
  }
  onUpdate({ name: file.name, status: "uploading", progress: 0 });
  try {
    await service.putFile(file, upload, (progress) => {
      onUpdate({ name: file.name, status: "uploading", progress });
    });
    onUpdate({ name: file.name, status: "succeeded", progress: 1 });
  } catch (error) {
    onUpdate({
      name: file.name,
      status: error instanceof UploadCollisionError ? "collision" : "failed",
    });
  }
}

function putFileWithProgress(
  file: File,
  upload: SignedUpload,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", upload.url);
    for (const [name, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener("load", () => {
      if (request.status === collisionStatus) {
        reject(new UploadCollisionError());
      } else if (
        request.status >= successfulStatusMinimum &&
        request.status < successfulStatusMaximum
      ) {
        resolve();
      } else {
        reject(new Error("upload failed"));
      }
    });
    request.addEventListener("error", () => {
      reject(new Error("upload failed"));
    });
    request.send(file);
  });
}
