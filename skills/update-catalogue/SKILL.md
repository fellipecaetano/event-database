---
name: update-catalogue
description: Run the catalogue update workflow when inbox Documents must be pulled, extracted, ingested, verified, and normally published. Use for requests to update or refresh the catalogue; use local mode only for explicit preview, prepare, dry-run, or no-publish requests.
---

# Update Catalogue

This skill coordinates the update. It owns sequencing and stop conditions; extraction policy stays
in [`extract-document`](../extract-document/SKILL.md), and publication policy stays in
[`deploy-catalogue`](../deploy-catalogue/SKILL.md).

## Establish Context

Work from the repository root. Read `README.md`, `CONTEXT.md`, `docs/decisions.md`, and the
extraction skill before processing a file.

Select the mode from the request:

- **publish** for `update`, `refresh`, `deploy`, or `publish`; this is an explicit request for the
  normal end-to-end workflow, including its documented bounded cloud mutation;
- **local** for `preview`, `prepare`, `dry-run`, `local`, or `no publish`;
- **data** when the request explicitly limits work to pulling, extracting, ingesting, or verifying.

Read the ignored repository-root `.catalogue.local.json`. It supplies `aws.expectedAccount`,
`aws.region`, `aws.preferredProfile`, `cloudFormation.stackName`, and
`catalogue.operatorIdentity`. Validate these local defaults before asking the operator for anything.
Use the preferred profile when it exists and resolves to the expected non-root account. Otherwise,
select a configured non-root profile that resolves to that account; ask only when none or more than
one does. The request delegates routine, evidence-backed Source-kind Judgements to the configured
operator identity. Ask when the file or a required value is missing, discovered state contradicts
it, or the work would attribute a genuinely semantic choice to a person.

Run every AWS discovery command with the selected profile and configured region. Validate STS
identity and stop for a root ARN, a wrong account, a missing profile, or a region mismatch. The
local configuration, not STS output, establishes the expected account.

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

Use Document evidence and existing catalogue records to establish Source attribution. Reuse the
same stable slug for every Document from the same publisher. Evidence-backed attribution is a
determination, not a confirmation gate. When one file remains genuinely unattributed, mark it
blocked, process every independent file first, then ask one focused question about only that file.
Never label parser output as a person or model Extractor.

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

If the first Document establishes a Source kind, write a separate judgement draft under the
configured operator identity and use the existing command:

```sh
pnpm catalogue judge /tmp/source-kind.json
pnpm catalogue verify
```

Do not add a second Source-kind mutation path. Record a kind without asking when the Source's
published role establishes exactly one kind. When more than one kind remains defensible, finish
independent work and ask one focused semantic question.

Report every semantic judgement, every field the Document did not supply, and every warning. A Span
being present proves only that the cited text occurs; it does not prove that the value is correctly
interpreted.

## Build And Publish

In **data** mode, finish after the verified pending batch.

In **local** mode, hand off to `deploy-catalogue` in dry-run mode. It owns the full local gate,
candidate build, smoke test, and planned-sync report without AWS mutation.

In **publish** mode, hand off the selected profile, expected account, stack, region, and authorization
to `deploy-catalogue`. That skill exclusively owns the full gate, single candidate build, local smoke
test, sync inspection, publication, invalidation, and remote verification. Do not build an earlier
candidate or repeat its procedure here.

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

Full completion means `pending --json` is empty for the intended batch, `pnpm catalogue verify`
passes, and the selected mode completes. If a semantic blocker remains, complete and verify every
independent file before reporting partial completion with the blocked filenames and precise questions.
