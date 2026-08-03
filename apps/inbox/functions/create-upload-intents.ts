import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  parseUploadIntent,
  type UploadIntent,
} from "../src/upload-contract.js";

const uploadUrlLifetimeSeconds = 300;
const badRequestStatus = 400;
const internalServerErrorStatus = 500;
const jsonHeaders = { "content-type": "application/json" };

export interface ApiGatewayRequest {
  readonly body: string | null;
}

export interface ApiGatewayResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface UploadIntentHandlerDependencies {
  readonly bucket: string;
  readonly signUpload: (input: {
    readonly bucket: string;
    readonly key: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly expiresInSeconds: number;
  }) => Promise<string>;
}

export function createUploadIntentHandler(
  dependencies: UploadIntentHandlerDependencies,
): (event: ApiGatewayRequest) => Promise<ApiGatewayResponse> {
  return async (event) => {
    let intent: UploadIntent;
    try {
      intent = parseUploadIntent(parseBody(event.body));
    } catch {
      return failure(badRequestStatus, "invalid upload request");
    }
    try {
      const uploads = await Promise.all(
        intent.files.map(async (file) => {
          const key = `inbox/${file.name}`;
          const url = await dependencies.signUpload({
            bucket: dependencies.bucket,
            key,
            contentType: file.contentType,
            contentLength: file.size,
            expiresInSeconds: uploadUrlLifetimeSeconds,
          });
          return {
            name: file.name,
            url,
            headers: {
              "Content-Type": file.contentType,
              "If-None-Match": "*",
            },
          };
        }),
      );
      return success({ uploads });
    } catch {
      return failure(
        internalServerErrorStatus,
        "could not create upload request",
      );
    }
  };
}

const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

export function createS3UploadSigner(
  client: S3Client,
): UploadIntentHandlerDependencies["signUpload"] {
  return async ({
    bucket,
    key,
    contentType,
    contentLength,
    expiresInSeconds,
  }) =>
    getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
        IfNoneMatch: "*",
      }),
      { expiresIn: expiresInSeconds },
    );
}

export async function handler(
  event: ApiGatewayRequest,
): Promise<ApiGatewayResponse> {
  return createUploadIntentHandler({
    bucket: requiredEnvironment("CATALOGUE_DATA_BUCKET"),
    signUpload: createS3UploadSigner(s3),
  })(event);
}

function parseBody(body: string | null): unknown {
  if (body === null) {
    throw new Error("request body is required");
  }
  return JSON.parse(body) as unknown;
}

function success(value: unknown): ApiGatewayResponse {
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify(value),
  };
}

function failure(statusCode: number, error: string): ApiGatewayResponse {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify({ error }),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}
