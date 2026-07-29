import { describe, expect, it } from "vitest";

import { compareJudgementPrecedence } from "./judgement-precedence.js";

describe("Judgement precedence", () => {
  it("ranks people above readers above matchers", () => {
    const at = "2026-07-28T12:00:00Z";
    const person = { by: "person:reviewer", at };
    const reader = { by: "reader@1", at };
    const matcher = { by: "matcher@1", at };

    expect(compareJudgementPrecedence(person, reader)).toBeGreaterThan(0);
    expect(compareJudgementPrecedence(reader, matcher)).toBeGreaterThan(0);
  });

  it("uses append time to break equal-actor ties", () => {
    const earlier = { by: "person:reviewer", at: "2026-07-28T12:00:00Z" };
    const later = { by: "person:other", at: "2026-07-28T13:00:00Z" };

    expect(compareJudgementPrecedence(later, earlier)).toBeGreaterThan(0);
  });
});
