# event-database

A catalogue of music events in Brazil, starting in São Paulo. It treats data quality as
the product: each catalogue fact is derived from immutable, retained source material and can
be traced back to the evidence that supports it.

## Status

This stores an append-only JSONL log, verifies it, ingests source Artefacts, produces a
deterministic matching-review queue, and can derive a public static catalogue site from the
Folded catalogue.

## Quick start

Requires Node.js and pnpm.

```sh
pnpm install
pnpm check
```

`pnpm check` formats, lints, typechecks, tests, builds, and verifies the catalogue.

## Commands

Build before invoking the CLI directly:

```sh
pnpm build
pnpm catalogue pending
pnpm catalogue pending --json
pnpm catalogue inbox pull
pnpm catalogue ingest /path/to/draft.json data/inbox/source-file
pnpm catalogue reextract /path/to/reextract.json
pnpm catalogue judge /path/to/judgement.json
pnpm catalogue review
pnpm catalogue review --at 2026-07-28T12:00:00Z
pnpm catalogue review --repository /path/to/repository
pnpm catalogue review --interactive --by person:you
pnpm catalogue verify
pnpm catalogue build-site --output /tmp/event-database-site --site-name "Agenda musical"
```

`ingest` validates a draft, mints record identifiers, hashes and retains the Artefact, and
appends the Document and Observations with rollback if a write fails. `reextract` appends
replacement Observations for a retained Document while preserving subject identity. `judge`
appends validated Matches, Overrides, Validations, or Redirects. `verify` validates the entire
log, retained text, references, and Artefact hashes.
`review` uses the current clock and repository by default; use `--at` for reproducible
output and `--repository` to read another checkout. Without `--interactive` it prints the
queue as JSON for a machine to consume.
`pending --json` reports pending inbox filenames, repository paths, Artefact references, and
SHA-256 hashes as stable JSON for update automation; without it, the command prints paths only.

`build-site` writes a disposable static public site from the verified Fold. It requires
`--output` and `--site-name`; accepts an optional repository positional argument, `--at`,
`--locale pt-BR`, `--base-url`, and `--theme <css-file>`; and refuses to replace directories
it does not own. The output contains no Documents, evidence, internal IDs, or retained
Artefacts. `base.css` owns layout while `theme.css` owns semantic theme tokens, so a custom
theme can be supplied without changing generated files.

The reference AWS deployment serves the generated catalogue from
`https://musicaemsp.com.br/`. Use the `deploy-catalogue` skill to prepare, dry-run, or publish
the catalogue after the shared infrastructure exists. It publishes only generated output to the
private catalogue website bucket; it does not update CloudFormation or access catalogue source
data.

### Remote inbox

The optional inbox uploader at `https://musicaemsp.com.br/inbox/` is a private React application
that writes files only to a remote `inbox/`; it never serves Artefacts or ingests Documents. Pull
those files into the existing local workflow with AWS credentials configured through the normal
provider chain:

```sh
export CATALOGUE_DATA_BUCKET=<CloudFormation DataBucket output>
export AWS_REGION=<CloudFormation Region output>
pnpm catalogue inbox pull
```

`inbox pull` atomically installs each file into `data/inbox/`, deletes only the exact remote
version after a successful or equal-byte local install, and leaves byte conflicts untouched.

The inbox infrastructure is the internal reference implementation for the shared S3, CloudFront,
Route 53, ACM, Cognito, and upload API stack. The `deploy-inbox` skill is its sole infrastructure
deployment procedure. It is not supported deployment tooling for third parties; use a separate AWS
account and security review before adapting it.

The stack permits `http://localhost:5173` as the development callback and CORS origin. Override
the `DevelopmentOrigin` CloudFormation parameter only when running Vite on another localhost port.
Self-registration is disabled; create uploader accounts separately in Cognito with the `UserPoolId`
stack output.

### Working the review queue

`review --interactive` walks the queue one case at a time so you can settle duplicates
without hand-writing Judgement drafts. It needs a terminal, and it needs to know who is
deciding: pass `--by person:<id>` or answer the prompt it asks once at the start.

The queue holds three kinds of case. Standing proposals come first, then Venue pairs, then
Event pairs, so identity decisions that can simplify later cases are settled first.

**Venue pairs** have the same controls as Event pairs. They show each Venue's name, address,
neighbourhood, city, and supporting Sources. Choosing `same` asks which Venue ID survives,
re-points every Observation from the other Venue, and records a Redirect. Candidate generation
requires the same normalized name and rejects pairs whose stated cities conflict; matching
addresses are shown as an additional reason after the decision is recorded.

**Event pairs** show two Events side by side, labelled A and B, with the evidence behind
them — title and line-up, date, start and showtime, venue, status, how many Observations back
it, and each supporting Source with the claim spans it stated. They deliberately show you no
score, no machine verdict, and no reason for the pairing; those are revealed only once your
decision is recorded, so your judgements stay usable as ground truth.

| Key | Meaning                                              |
| --- | ---------------------------------------------------- |
| `s` | Same Event — asks which ID survives, then merges      |
| `d` | Different Events                                     |
| `f` | Defer until new evidence touches either side         |
| `k` | Skip for this session, writing nothing               |
| `v` | Show the complete retained Documents, then ask again |
| `q` | Stop cleanly                                         |

For Event pairs, choosing `same` records a Match re-pointing every Observation under the losing Event onto the
survivor, plus a Redirect retiring the losing ID. When the two sides sat at different Venues,
it also raises a *proposal* that those Venues are one — never acting on the inference itself,
because a single wrong Event merge would otherwise collapse two real rooms.

**Proposals** are Matches the system raised but nobody vouched for. They carry no authority:
neither the Fold nor the queue reads a record marked `proposed`, so a proposal changes nothing
until a person answers it. Its case names what raised it — unlike an Event pair, a proposal is
unintelligible without that — and shows both entities with the Source behind the one that
would move.

| Key | Meaning                                                     |
| --- | ----------------------------------------------------------- |
| `s` | Confirm — merges in the direction the proposal was raised    |
| `d` | Reject                                                      |
| `f` | Defer                                                       |
| `k` | Skip for this session, writing nothing                      |
| `v` | Show the complete retained Documents, then ask again         |
| `q` | Stop cleanly                                                |

A proposal names its own direction, so confirming one never asks which side survives. Every
answer records a settled Match at the proposal's own subject and entity — that is what stops
it being raised again — and confirming adds the Redirect retiring the entity it merged away.

`same`, `different`, and `deferred` may carry a short reason. Each decision is verified
against the whole log and appended before the next case, and the queue is rebuilt afterwards
because a merge can invalidate later candidates. Quitting or interrupting keeps every
completed case and writes nothing for the case in progress.

For the structured ingestion procedure, read
[the extraction skill](./skills/extract-document/SKILL.md).

## Layout

- `data/` — append-only catalogue log, retained Artefacts, and inbox.
- `packages/core/` — schemas, verification, ingestion primitives, Fold, matching, and review
  cases.
- `packages/catalogue-site/` — deterministic public static-site generator.
- `apps/cli/` — command-line boundary.
- `apps/inbox/` — private browser gathering boundary and its AWS stack.
- `docs/` — architecture decisions, ADRs, record-shape rationale, and working sessions.

## Project record

Start with [CONTEXT.md](./CONTEXT.md) for domain language and
[docs/decisions.md](./docs/decisions.md) for deliberate product and architecture choices.
The executable record schemas are in
[packages/core/src/records.ts](./packages/core/src/records.ts).

The log is append-only. Do not edit or replace existing records; add a new Observation or
Judgement that records the correction.

## License

No license is granted. The source is visible for review only; reuse, redistribution, and
contributions require explicit permission from the maintainer.
