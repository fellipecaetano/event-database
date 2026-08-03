import { useState } from "react";

import {
  uploadFiles,
  type UploadService,
  type UploadUpdate,
} from "./upload.js";

const percentScale = 100;

export interface AppProperties {
  readonly accessToken: string;
  readonly uploadService: UploadService;
}

export function App({
  accessToken,
  uploadService,
}: AppProperties): React.JSX.Element {
  const [uploads, setUploads] = useState<ReadonlyMap<string, UploadUpdate>>(
    new Map(),
  );
  const [error, setError] = useState<string | undefined>();
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (files: readonly File[]): Promise<void> => {
    setError(undefined);
    try {
      await uploadFiles(files, accessToken, uploadService, (update) => {
        setUploads((previous) => {
          const next = new Map(previous);
          next.set(update.name, update);
          return next;
        });
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "could not upload files",
      );
    }
  };

  return (
    <main className="upload-page">
      <label
        className={`drop-target${isDragging ? " is-dragging" : ""}`}
        onDragEnter={() => {
          setIsDragging(true);
        }}
        onDragLeave={() => {
          setIsDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void handleFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          aria-label="Choose files"
          className="file-input"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void handleFiles(files);
          }}
          type="file"
        />
        <span className="drop-target__title">Choose files</span>
        <span className="drop-target__hint">or drop them here</span>
      </label>
      <section aria-live="polite" className="upload-statuses">
        {[...uploads.values()].map((upload) => (
          <p key={upload.name}>{describeUpload(upload)}</p>
        ))}
      </section>
      {error === undefined ? null : (
        <p aria-live="assertive" className="upload-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function describeUpload(upload: UploadUpdate): string {
  switch (upload.status) {
    case "queued":
      return `Queued ${upload.name}`;
    case "uploading":
      return `Uploading ${upload.name}${formatProgress(upload.progress)}`;
    case "succeeded":
      return `Uploaded ${upload.name}`;
    case "collision":
      return `${upload.name} already exists in the inbox`;
    case "failed":
      return `Could not upload ${upload.name}`;
  }
  throw new Error("unsupported upload status");
}

function formatProgress(progress: number | undefined): string {
  if (progress === undefined) {
    return "";
  }
  return ` ${String(Math.round(progress * percentScale))}%`;
}
