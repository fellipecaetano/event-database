import { z } from "zod";

import {
  matchSchema,
  overrideSchema,
  redirectSchema,
  recordVersions,
  validationSchema,
  type Judgement,
} from "./records.js";

export const judgementDraftSchema = z.discriminatedUnion("type", [
  matchSchema.omit({ id: true, at: true, v: true }),
  overrideSchema.omit({ id: true, at: true, v: true }),
  validationSchema.omit({ id: true, at: true, v: true }),
  redirectSchema.omit({ id: true, at: true, v: true }),
]);

export type JudgementDraft = z.output<typeof judgementDraftSchema>;

interface JudgementContext {
  readonly id: string;
  readonly at: string;
}

export function prepareJudgement(
  input: JudgementDraft,
  context: JudgementContext,
): Judgement {
  const draft = judgementDraftSchema.parse(input);
  switch (draft.type) {
    case "match":
      return matchSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.match,
      });
    case "override":
      return overrideSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.override,
      });
    case "redirect":
      return redirectSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.redirect,
      });
    case "validation":
      return validationSchema.parse({
        ...draft,
        ...context,
        v: recordVersions.validation,
      });
  }
  throw new Error("unsupported Judgement draft");
}
