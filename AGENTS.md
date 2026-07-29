# event-database

Brazilian live-music catalogue, São Paulo first. Data quality is the product.

## Read first

Read [README.md](./README.md), [CONTEXT.md](./CONTEXT.md), ADRs in `docs/adr/`, and
[decisions.md](./docs/decisions.md). Existing decisions are deliberate: argue with the
record rather than working around it.

## Engineering Standard

## Working rules

- Keep this file terse, short, and effective.
- TypeScript on Node.js in a pnpm workspace: products in `apps/`, libraries in `packages/`.
- Prefer the smallest clear change. Preserve behavior unless intentionally changing it.
- Model constraints in types; validate untrusted input; keep strict TypeScript strict.
- Keep package boundaries real: public APIs only, no dependency cycles or source imports.
- Use comments only for non-obvious why.
- Make dependencies earn their place.

## Tests

- Every executable behavior change follows TDD: write and run the smallest failing test, make
  it pass, then refactor green.
- Every bug fix starts with a failing regression test.
- Test behavior and failure modes, not implementation details.

### Version Control

- Commit message subject: 50 characters max. Body: no length limit, but wrap lines at 72 characters.
- When asked to commit, make a best effort to commit everything, regardless of how many commits there should be.
- If the commit message says two things (or more), it means the commit should probably be two commits (or more). In that case, create more than one commit.

## Done

- Review the diff for accidental complexity and unrelated churn.
- Always check whether `README.md` needs updating; update it when users, commands, setup, or
  architecture changed.
- Run the affected formatter, lint, typecheck, tests, and build. Fix failures at their root.
