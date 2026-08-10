---
name: update-catalogue
description: Run the catalogue update workflow when new inbox Documents must be pulled, extracted, ingested, verified, and optionally published. Use for requests to update or refresh the catalogue; stop for unresolved Source attribution, semantic extraction, AWS identity, or publication approval.
---

# Update Catalogue

This skill coordinates the update. It owns sequencing and stop conditions; extraction policy stays
in [`extract-document`](../extract-document/SKILL.md), and publication policy stays in
[`deploy-catalogue`](../deploy-catalogue/SKILL.md).

## Establish Context

Work from the repository root. Read `README.md`, `CONTEXT.md`, `docs/decisions.md`, and the
extraction skill before processing a file.

Ask for these values when they are not already known:

- `PROFILE`: AWS CLI profile.
- `EXPECTED_ACCOUNT`: AWS account that owns the deployment.
- `BY`: person identity used for Source-kind judgements.
- `STACK_NAME`: CloudFormation stack name. The reference stack is `event-database-inbox`; confirm
  before using that default.

The update operates in `us-east-1`. Run every AWS discovery command with the selected profile and
region. Validate STS identity and stop for a root ARN, a wrong account, a missing profile, or a
region mismatch. STS account output is not an expected-account decision; use the supplied account
or ask the operator to confirm it.

Discover the stack with `describe-stacks`. Require a stable completed stack and outputs `DataBucket`
and `Region`. Do not use the catalogue deployment skill's AWS commands to discover or access the
DataBucket; that skill deliberately cannot access it.

## Pull And Inventory

Build the CLI before invoking it:

```sh
pnpm build
```

Pass remote inbox configuration inline. Do not require persistent shell exports:

```sh
CATALOGUE_DATA_BUCKET="$DATA_BUCKET" AWS_REGION="$REGION" pnpm catalogue inbox pull
```

Record the pull result. A conflict is a stop condition; do not overwrite either byte sequence.

Inventory only pending files:

```sh
pnpm catalogue pending --json
```

An empty JSON array is successful completion for the data phase. Process only files listed by this
command. Successfully ingested files move out of the inbox; rerunning this step is the restart
mechanism after interruption.

## Extract And Ingest

For each pending file, follow `extract-document/SKILL.md`.

Stop and ask when the Source slug or attribution is not established. Keep the same stable slug for
every Document from the same publisher. Never label parser output as a person or model Extractor.

Write drafts outside the repository or in an ignored temporary directory. Do not write private
source text into tracked files. Use the CLI as the only owner of identifiers, hashes, Artefact
movement, and append transactions:

```sh
pnpm catalogue ingest /tmp/draft.json data/inbox/<filename>
```

Real ingest is the authoritative admission operation. It verifies the complete candidate log before
filesystem mutation and its commit path rechecks source bytes and destination absence. Do not invent
a dry-run or treat a preflight as a guarantee that a later ingest cannot race with another change.

After each successful ingest batch, verify:

```sh
pnpm catalogue verify
```

If the first Document establishes a Source kind, write a separate judgement draft and use the
existing command:

```sh
pnpm catalogue judge /tmp/source-kind.json
pnpm catalogue verify
```

Do not add a second Source-kind mutation path. If the kind is uncertain, stop and ask.

Report every semantic judgement, every field the Document did not supply, and every warning. A Span
being present proves only that the cited text occurs; it does not prove that the value is correctly
interpreted.

## Build And Publish

Run the full local gate and use a fresh temporary output as required by `deploy-catalogue`.

For a local-only update, build and report the candidate without AWS mutation. For an explicit
publication request, hand off to `deploy-catalogue`; do not copy its identity, stack, sync,
invalidation, or HTTPS verification procedure here.

The publication lifecycle is:

1. Check baseline deployment health if requested.
2. Build the candidate once.
3. Smoke-test that exact local candidate.
4. Show the candidate tree and deployment scope.
5. Obtain explicit publication approval.
6. Publish through `deploy-catalogue`.
7. Smoke-test the deployed release through that skill.

Never run deployed smoke tests before publication and describe them as validation of the candidate;
they can observe only the previous release.

## Completion Report

Report:

- pull counts and conflicts;
- each processed filename;
- Document and Observation counts;
- Source attribution and Source-kind judgements;
- omitted facts and semantic decisions;
- verification result;
- elapsed preparation and publication time;
- shell-command count when practical;
- draft count and approximate model-authored draft size;
- failed ingest attempts and causes;
- semantic questions requiring a person;
- Documents per source format;
- full-gate duration;
- deployment result only when publication was explicitly requested.

Completion means `pending --json` is empty for the intended batch, `pnpm catalogue verify` passes,
and either the candidate is locally verified or the delegated deployment skill reports successful
publication and remote verification.
