import { describe, expect, it } from "vitest";

import {
  maximumFilesPerUpload,
  maximumUploadBatchBytes,
  maximumUploadBytes,
  parseUploadIntent,
  validateInboxFilename,
} from "./upload-contract.js";

describe("validateInboxFilename", () => {
  it("preserves a portable direct filename", () => {
    expect(validateInboxFilename("Ao vivo - sexta.png")).toBe(
      "Ao vivo - sexta.png",
    );
  });

  it.each(["", ".", "..", ".hidden.png", "nested/file", "nested\\file"])(
    "rejects unsafe filename %j",
    (filename) => {
      expect(() => validateInboxFilename(filename)).toThrow(
        "invalid inbox filename",
      );
    },
  );

  it("rejects a filename longer than 255 UTF-8 bytes", () => {
    expect(() => validateInboxFilename("a".repeat(256))).toThrow(
      "invalid inbox filename",
    );
  });
});

describe("parseUploadIntent", () => {
  it("normalizes a missing media type", () => {
    expect(parseUploadIntent({ files: [{ name: "flyer", size: 1 }] })).toEqual({
      files: [
        {
          contentType: "application/octet-stream",
          name: "flyer",
          size: 1,
        },
      ],
    });
  });

  it("rejects duplicate filenames in one request", () => {
    expect(() =>
      parseUploadIntent({
        files: [
          { name: "flyer.png", size: 1 },
          { name: "flyer.png", size: 2 },
        ],
      }),
    ).toThrow("duplicate inbox filename");
  });

  it("rejects requests beyond the file limit", () => {
    expect(() =>
      parseUploadIntent({
        files: Array.from(
          { length: maximumFilesPerUpload + 1 },
          (_, index) => ({
            name: `file-${String(index)}`,
            size: 1,
          }),
        ),
      }),
    ).toThrow("too many files");
  });

  it("rejects files beyond the size limit", () => {
    expect(() =>
      parseUploadIntent({
        files: [{ name: "large.png", size: maximumUploadBytes + 1 }],
      }),
    ).toThrow("file exceeds");
  });

  it("rejects requests beyond the aggregate size limit", () => {
    expect(() =>
      parseUploadIntent({
        files: [
          {
            name: "first.png",
            size: Math.floor(maximumUploadBatchBytes / 3) + 1,
          },
          {
            name: "second.png",
            size: Math.floor(maximumUploadBatchBytes / 3) + 1,
          },
          {
            name: "third.png",
            size: Math.floor(maximumUploadBatchBytes / 3) + 1,
          },
        ],
      }),
    ).toThrow("upload batch exceeds");
  });
});
