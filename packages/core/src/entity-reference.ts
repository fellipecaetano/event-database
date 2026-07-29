import { z } from "zod";

const entityKindSchema = z.enum(["event", "venue", "source"]);

export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "expected a UUIDv7",
  );

export const entityReferenceSchema = z
  .string()
  .regex(
    /^(event|venue):[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^source:[a-z0-9][a-z0-9._/-]*$/i,
    "expected an entity reference",
  );

export type EntityKind = z.infer<typeof entityKindSchema>;

export interface ParsedEntityReference {
  readonly kind: EntityKind;
  readonly id: string;
}

export function formatEntityReference(
  reference: ParsedEntityReference,
): string {
  return entityReferenceSchema.parse(`${reference.kind}:${reference.id}`);
}

export function parseEntityReference(value: string): ParsedEntityReference {
  const reference = entityReferenceSchema.parse(value);
  const separator = reference.indexOf(":");
  return {
    kind: entityKindSchema.parse(reference.slice(0, separator)),
    id: reference.slice(separator + 1),
  };
}
