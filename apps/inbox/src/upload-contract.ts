import { z } from "zod";

export const maximumFilesPerUpload = 20;
export const maximumUploadBytes = 26_214_400;
const maximumFilenameBytes = 255;
const defaultContentType = "application/octet-stream";
const firstPrintableCharacter = 32;
const deleteCharacter = 127;

const uploadIntentSchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().nonnegative(),
      type: z.string().optional(),
    }),
  ),
});

export interface UploadFileIntent {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface UploadIntent {
  readonly files: readonly UploadFileIntent[];
}

export function validateInboxFilename(filename: string): string {
  if (
    filename.length === 0 ||
    filename === "." ||
    filename === ".." ||
    filename.startsWith(".") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    containsControlCharacter(filename) ||
    new TextEncoder().encode(filename).byteLength > maximumFilenameBytes
  ) {
    throw new Error(`invalid inbox filename: ${filename}`);
  }
  return filename;
}

export function parseUploadIntent(input: unknown): UploadIntent {
  const parsed = uploadIntentSchema.parse(input);
  if (parsed.files.length > maximumFilesPerUpload) {
    throw new Error(
      `too many files: maximum is ${String(maximumFilesPerUpload)}`,
    );
  }

  const names = new Set<string>();
  const files = parsed.files.map((file) => {
    const name = validateInboxFilename(file.name);
    if (names.has(name)) {
      throw new Error(`duplicate inbox filename: ${name}`);
    }
    if (file.size > maximumUploadBytes) {
      throw new Error(
        `file exceeds ${String(maximumUploadBytes)} bytes: ${name}`,
      );
    }
    names.add(name);
    return {
      name,
      size: file.size,
      contentType: validateContentType(file.type),
    };
  });
  return { files };
}

function validateContentType(contentType: string | undefined): string {
  if (contentType === undefined || contentType.length === 0) {
    return defaultContentType;
  }
  if (containsControlCharacter(contentType)) {
    throw new Error("invalid file content type");
  }
  return contentType;
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
