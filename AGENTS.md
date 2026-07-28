# event-database

A catalogue of live music events in Brazil, São Paulo first. Personal tool now, public
aggregator later, with **data quality as the differentiator**.

Read [CONTEXT.md](./CONTEXT.md) for the domain language and files in `docs/adr/*` and [docs/decisions.md](./docs/decisions.md) for what has been decided and why. Most of what looks like an odd choice here is deliberate
and recorded. If a decision seems wrong, argue with the record rather than working around it.

There are skills in you can use in `skills/*`.

Keep this file short. A long one stops being read.

---

## Tech stack

A modern TypeScript monorepo. Deployables in `apps/`, libraries on `packages/`. Read the project configuration files you'd typically find in such a project for more information.

## Engineering Standard

Optimize for correctness, clarity, simplicity, and changeability—not speed of implementation.

### Work

- Understand existing architecture, conventions, invariants, and tests before editing.
- Make the smallest coherent change. Preserve behavior unless change is intentional.
- Improve nearby code when it materially reduces complexity; avoid unrelated churn.
- Before finishing, review the diff as a staff engineer: remove accidental complexity, duplication, weak names, leaky abstractions, and unnecessary code.

### Design

- Prefer simple composition and explicit data flow over indirection, inheritance, frameworks, or cleverness.
- Model domain constraints in types; make invalid states hard to represent.
- Keep modules cohesive, APIs small, dependencies directional, and package boundaries real.
- Abstract only after a stable concept exists. Duplication is cheaper than the wrong abstraction.
- Separate pure domain logic from I/O and side effects where practical.
- Treat public APIs, persisted data, and cross-package contracts as compatibility boundaries.

### TypeScript

- Keep strictness maximal. Never weaken compiler/lint rules to make code pass.
- Avoid `any`, assertions, non-null assertions, and unchecked casts. Narrow `unknown` at boundaries.
- Prefer inference for locals; explicit types for contracts when they improve clarity.
- Prefer discriminated unions for variants and exhaustive handling.
- Prefer immutable values and `const`; mutate only when simpler and locally contained.
- Use modern language/platform APIs; do not recreate standard functionality.
- Validate untrusted runtime input. Static types do not validate runtime data.
- Handle promises deliberately; propagate, await, or explicitly discard them.
- Errors must add context or preserve the original cause. Do not swallow failures.

### Code

- Readability, then maintainability, then beauty&elegance, then everything else. Beauty and elegance are very important.
- Names expose intent. Functions do one conceptual job. Control flow stays shallow.
- Prefer early returns to nesting; readable code to comments; comments explain why, not what.
- Delete dead code. Do not retain speculative extension points or compatibility shims without a requirement.
- Follow repository formatting and naming automatically; do not create competing style conventions.
- Dependencies require clear value. Prefer platform or existing dependencies before adding one.

### Tests

- Test observable behavior, contracts, boundaries, and failure modes—not implementation details.
- Every bug fix gets a regression test when feasible.
- Tests must be deterministic, isolated, readable, and proportionate to risk.
- Do not distort production design merely to satisfy tests.

### Comments

**Comment sparingly, and briefly.** Default to writing none. The test: if deleting a
comment would lose nothing, it should not have been written.

A comment earns its place only when the code cannot carry the information itself — a
surprising _why_, a constraint that is invisible from where you are reading, or a
deliberate choice that someone would otherwise "fix". Never restate what the code already
says, and never narrate a sequence of steps that the steps themselves make obvious.

Keep one to a single line wherever it will fit.

### Monorepo

- Import packages only through their public API; no cross-package source imports.
- Do not create dependency cycles.
- Put code in the narrowest package that owns the concept; shared code requires genuine shared semantics.
- Keep package scripts and configuration consistent unless divergence is required.

### Done

- Run the repository's formatter, lint, typecheck, tests, and build for the affected scope.
- Fix root causes, not symptoms.
- Fix all failures. Do not suppress them – if you can't fix, flag, but don't decide to bypass on your own.
- Leave the codebase at least as coherent as you found it.
