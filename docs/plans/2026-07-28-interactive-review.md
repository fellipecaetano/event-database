# Interactive review

Date: 2026-07-28

Status: ready to implement

## Goal

Add `--interactive` to `catalogue review`. The existing command must continue to emit the
unchanged machine-readable JSON queue when the flag is absent. Interactive mode is for a
human reviewer: show concise but sufficient source evidence, ask for a decision on each
candidate, and immediately append the resulting Judgements.

Follow TDD for every behavior change.

## Read first

- `AGENTS.md`
- `CONTEXT.md`
- Matching decisions in `docs/decisions.md`, especially review blindness, review outcomes,
  queue derivation, precedence, and merge/split behavior
- Match and Redirect shapes in `docs/record-shapes.md`
- `packages/core/src/matching.ts`
- `packages/core/src/fold.ts`
- `packages/core/src/judgement.ts`
- `apps/cli/src/main.ts` and their existing tests

The important invariant is **review blind**: before deciding, the reviewer may see source
evidence but not `ReviewCandidate.reasons`, a score, a machine verdict, or a proposed answer.

## CLI contract

```text
catalogue review [--interactive] [--by person:<id>] [--at <timestamp>]
                 [--repository <path>]
```

- Without `--interactive`, preserve current arguments, output, and exit behavior.
- `--interactive` is a valueless flag and may appear in any option order.
- `--by` is valid only in interactive mode and must begin with `person:`.
- If `--by` is absent, ask for it once before showing the first case.
- Require an interactive stdin/stdout terminal in production. Return a clear error otherwise.
  Tests use injected terminal I/O and need no real TTY.
- `--at` pins the Fold used to derive the queue. It must not backdate new Judgements; use the
  actual CLI clock when each decision is recorded.

## Review presentation

Create a pure core representation of a human review case from the records, Fold, and
`ReviewCandidate`. Keep it separate from the machine-facing candidate shape.

Show two sides labelled A and B. For each side, include when present:

- Event ID
- title and lineup
- date, start, and showtime
- venue name
- status and ticket signal
- Observation count
- each supporting Source
- publication time, falling back to retrieval time
- relevant claim spans from the retained Document

Document and Observation IDs may be secondary details. Do not dump an entire Document in the
default view. A `view sources` action may show the complete retained Documents.

Example:

```text
Case 1 of 7 — 30 July 2026

A — event:...
  Terno Rei
  20:00 · Cine Joia
  Sources:
    cine-joia · published 24 Jul
      “Terno Rei ... 30/07 ... 20h”

B — event:...
  Terno Rei
  21:00 · Cine Joia
  Sources:
    ticket-site · retrieved 25 Jul
      “Terno Rei — Cine Joia — 30 de julho”

[s]ame  [d]ifferent  de[f]er  s[k]ip  [v]iew sources  [q]uit
Decision:
```

Rendering belongs at the CLI boundary. Evidence selection and ordering belong in pure core
functions. Use deterministic ordering throughout.

## Interactive loop

Support:

- `s`: same
- `d`: different
- `f`: defer until new evidence
- `k`: skip for this session without writing
- `v`: show complete source Documents, then ask again
- `q`: stop cleanly

Reprompt on unknown or empty input. After `same`, `different`, or `deferred`, offer an optional
short reason. For `same`, ask which Event ID survives, presenting A as the deterministic
default but requiring confirmation; the other Event is retired.

Append a completed decision before advancing. Then reread the log and rebuild the queue,
because a merge can change or invalidate later candidates. Maintain a session-local set of
skipped Event pairs so a skipped first candidate does not immediately reappear. EOF or
interruption must leave already appended cases intact and must not append the current
incomplete case.

Print a final summary of same, different, deferred, and skipped counts.

## Persisting decisions

Add a pure core preparation function that turns a reviewed case into a complete batch of
`JudgementDraft`s or Judgements. Reuse `prepareJudgement` and the UUIDv7 generator rather than
constructing record versions at the CLI boundary.

For `different` and `deferred`:

- Create one Match against the pair.
- Use a deterministic representative Observation from one side and target the other Event.
- Record the human reviewer in `by` and include a non-empty reason when supplied.
- Do not set `proposed`, `score`, or `creates_entity`.

For `same`:

- Create a `same` Match from every Observation currently grouped under the losing Event to the
  surviving Event. This re-points all its evidence.
- Create one Redirect from the losing Event to the survivor with reason `merged` or the
  reviewer's supplied reason.
- Do not use `creates_entity`; both Events already exist.

Generate all records for one case with one timestamp, verify the existing log plus the entire
batch, and append the batch to the applicable monthly Judgement partition with one
`appendFile` call. Nothing from a case may be written if preparation or verification fails.

After a successful append, machine-generated information may be revealed. Candidate reasons
are currently the only such information; render them only at this point. Do not reveal
anything before persistence succeeds.

## Code structure

Expected changes:

- `packages/core/src/matching.ts`: human review-case/evidence derivation, or a new cohesive
  `review.ts` module if keeping it in matching would mix responsibilities.
- `packages/core/src/judgement.ts`: pure reviewed-decision batch preparation.
- `packages/core/src/index.ts`: export the new public contracts.
- `apps/cli/src/main.ts`: option parsing, terminal adapter, rendering, loop, verification, and
  append orchestration.
- Existing core and CLI test files, split into focused new test files if clearer.

Use Node's `readline/promises`; add no dependency. Extend `CliDependencies` with the smallest
terminal seam needed for scripted questions, captured output, TTY detection, and clean close.

## TDD sequence

1. Lock down current non-interactive JSON behavior.
2. Test option parsing: valueless `--interactive`, any order, `--by` rules, timestamps, and
   non-TTY rejection.
3. Test pure review-case construction and deterministic rendering data. Assert explicitly that
   pre-decision data contains no machine reason, score, or verdict.
4. Test decision preparation:
   - different/deferred create one canonical Match;
   - same creates all losing-Observation Matches plus one Redirect;
   - chosen survivor, reviewer, reason, timestamp, IDs, and ordering are correct.
5. Test a scripted CLI session: reviewer prompt, A/B rendering, invalid response, full-source
   view, every verdict, skip, and quit.
6. Test queue rebuilding after a persisted decision and session suppression of skipped pairs.
7. Test failure safety: verification or append failure writes no partial case; EOF/interruption
   writes no incomplete case but retains prior completed cases.
8. Test that `--at` pins queue derivation while records use the real decision clock.
9. Add a temporary-repository integration test that rereads and verifies appended JSONL.

## Documentation and completion

- Update `README.md` with `--interactive`, `--by`, controls, and the human workflow.
- Update `docs/decisions.md` only where needed to record the settled interactive semantics:
  blind presentation, explicit merge survivor, immediate per-case persistence, and the
  distinction between review time and decision time.
- No persisted record shape change is expected; update `docs/record-shapes.md` only if the
  implementation changes that assumption.
- Run `pnpm format`, then `pnpm check`.
- Review the final diff for accidental complexity, public API leakage, and unrelated churn.

## Acceptance criteria

- Existing `catalogue review` consumers see no change without `--interactive`.
- A human can work or quit the complete derived queue without preparing JSON drafts.
- Every recorded decision is attributable to a `person:*` reviewer and passes full-log
  verification.
- The reviewer cannot see a machine answer before deciding.
- A merge durably re-points the losing evidence and redirects the retired Event.
- Completed cases survive interruption; incomplete cases never produce partial records.
