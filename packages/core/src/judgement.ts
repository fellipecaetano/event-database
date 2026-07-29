import { z } from "zod";

import {
  matchSchema,
  overrideSchema,
  redirectSchema,
  validationSchema,
  type Judgement,
} from "./records.js";

const versionOne = 1;
const versionTwo = 2;

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
      return matchSchema.parse({ ...draft, ...context, v: versionOne });
    case "override":
      return overrideSchema.parse({ ...draft, ...context, v: versionOne });
    case "redirect":
      return redirectSchema.parse({ ...draft, ...context, v: versionOne });
    case "validation":
      return validationSchema.parse({ ...draft, ...context, v: versionTwo });
  }
  throw new Error("unsupported Judgement draft");
}
