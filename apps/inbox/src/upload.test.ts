import { describe, expect, it, vi } from "vitest";

import {
  UploadCollisionError,
  uploadFiles,
  type UploadService,
} from "./upload.js";

function createFile(name: string): File {
  return new File(["source"], name, { type: "image/png" });
}

describe("uploadFiles", () => {
  it("uploads every selected file and reports success", async () => {
    const service: UploadService = {
      createIntents: vi.fn(() =>
        Promise.resolve({
          uploads: [
            {
              name: "first.png",
              url: "https://uploads.example/first.png",
              headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*" as const,
              },
            },
          ],
        }),
      ),
      putFile: vi.fn(() => Promise.resolve()),
    };
    const updates: string[] = [];

    await uploadFiles([createFile("first.png")], "token", service, (update) => {
      updates.push(`${update.name}:${update.status}`);
    });

    expect(updates).toEqual([
      "first.png:queued",
      "first.png:uploading",
      "first.png:succeeded",
    ]);
  });

  it("reports an existing S3 object as a collision", async () => {
    const service: UploadService = {
      createIntents: () =>
        Promise.resolve({
          uploads: [
            {
              name: "first.png",
              url: "https://uploads.example/first.png",
              headers: { "Content-Type": "image/png", "If-None-Match": "*" },
            },
          ],
        }),
      putFile: () => Promise.reject(new UploadCollisionError()),
    };
    const updates: string[] = [];

    await uploadFiles([createFile("first.png")], "token", service, (update) => {
      updates.push(`${update.name}:${update.status}`);
    });

    expect(updates.at(-1)).toBe("first.png:collision");
  });

  it("logs a safe development diagnostic when the direct upload fails", async () => {
    const error = new Error("upload failed with HTTP 403");
    const writeError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const service: UploadService = {
      createIntents: () =>
        Promise.resolve({
          uploads: [
            {
              name: "first.png",
              url: "https://uploads.example/first.png",
              headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*" as const,
              },
            },
          ],
        }),
      putFile: () => Promise.reject(error),
    };

    await uploadFiles(
      [createFile("first.png")],
      "token",
      service,
      () => undefined,
    );

    expect(writeError).toHaveBeenCalledWith("Inbox upload failed", {
      error: "upload failed with HTTP 403",
      file: "first.png",
    });
  });

  it("starts no more than three file uploads concurrently", async () => {
    let active = 0;
    let maximumActive = 0;
    const service: UploadService = {
      createIntents: (files) =>
        Promise.resolve({
          uploads: files.map((file) => ({
            name: file.name,
            url: `https://uploads.example/${file.name}`,
            headers: { "Content-Type": "image/png", "If-None-Match": "*" },
          })),
        }),
      putFile: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
      },
    };

    await uploadFiles(
      Array.from({ length: 4 }, (_, index) =>
        createFile(`file-${String(index)}.png`),
      ),
      "token",
      service,
      () => undefined,
    );

    expect(maximumActive).toBe(3);
  });
});
