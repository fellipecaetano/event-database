import { describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";

import {
  createS3UploadSigner,
  createUploadIntentHandler,
  type UploadIntentHandlerDependencies,
} from "./create-upload-intents.js";

function createDependencies(): UploadIntentHandlerDependencies {
  return {
    bucket: "catalogue-data",
    signUpload: vi.fn(({ key }) =>
      Promise.resolve(`https://uploads.example/${key}`),
    ),
  };
}

describe("createUploadIntentHandler", () => {
  it("signs the actual content length without an empty-body checksum", async () => {
    const signer = createS3UploadSigner(
      new S3Client({
        region: "us-east-1",
        credentials: {
          accessKeyId: "AKIATESTEXAMPLE0000",
          secretAccessKey: "test-secret",
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
    );

    const url = new URL(
      await signer({
        bucket: "catalogue-data",
        key: "inbox/flyer.png",
        contentType: "image/png",
        contentLength: 12,
        expiresInSeconds: 300,
      }),
    );

    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;host;if-none-match",
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  });

  it("signs server-owned conditional inbox uploads", async () => {
    const dependencies = createDependencies();
    const response = await createUploadIntentHandler(dependencies)({
      body: JSON.stringify({
        files: [{ name: "flyer.png", size: 12, type: "image/png" }],
      }),
    });

    expect(response).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploads: [
          {
            name: "flyer.png",
            url: "https://uploads.example/inbox/flyer.png",
            headers: {
              "Content-Type": "image/png",
              "If-None-Match": "*",
            },
          },
        ],
      }),
    });
    expect(dependencies.signUpload).toHaveBeenCalledWith({
      bucket: "catalogue-data",
      key: "inbox/flyer.png",
      contentType: "image/png",
      contentLength: 12,
      expiresInSeconds: 300,
    });
  });

  it("rejects malformed request bodies", async () => {
    const response = await createUploadIntentHandler(createDependencies())({
      body: "not json",
    });

    expect(response).toEqual({
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "invalid upload request" }),
    });
  });

  it("rejects unsafe filenames before signing", async () => {
    const dependencies = createDependencies();
    const response = await createUploadIntentHandler(dependencies)({
      body: JSON.stringify({
        files: [{ name: "nested/flyer.png", size: 12 }],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.signUpload).not.toHaveBeenCalled();
  });
});
