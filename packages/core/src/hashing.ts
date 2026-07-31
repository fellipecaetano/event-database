import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return hashBytes(new TextEncoder().encode(text));
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
