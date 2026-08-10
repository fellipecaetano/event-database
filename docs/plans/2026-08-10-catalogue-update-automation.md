# Catalogue Update Automation Plan

Status: Slice 1 proposed.

## Goal

Make the existing catalogue-update workflow reliable and repeatable while keeping permanent
interfaces small. Spend model and human attention on semantic decisions, not shell construction,
repetitive JSON, or deterministic validation.

## Evidence And Scope

The latest update contained one measured bottleneck: 110 grounded Observations from one recurring
Ao Vivo TSV format. That supports a later, narrow Ao Vivo adapter. It does not yet support generic
TSV infrastructure, permanent PDF conversion, Source administration commands, deployment-aware CLI
smoke testing, or multiple catalogue-only gates.

Record these measurements during several real updates before expanding scope:

- elapsed preparation and publication time;
- number of shell commands;
- number and size of model-authored drafts;
- failed ingest attempts and causes;
- semantic questions requiring a person;
- Documents per source format;
- repeated Source-kind judgements;
- time spent in the full repository gate.

Permanent interfaces are reserved for stable domain operations. Source-specific, deployment-specific,
and one-off operator procedures remain narrow skills or temporary tools until repeated use
demonstrates a reusable abstraction. Invariants are enforced by existing operations and verification,
never by optional convenience commands.

## Non-goals

- Do not automatically infer Source slugs or Source kinds.
- Do not automatically resolve ambiguous event identity.
- Do not invent missing city, venue, date, or time values.
- Do not add a generic TSV or permanent PDF interface in Slice 1.
- Do not add a second Source-kind mutation path beside `judge`.
- Do not add a deployment-specific `catalogue smoke-site` command.
- Do not change CloudFormation, Route 53, ACM, CloudFront configuration, Lambda, or inbox assets.
- Do not publish Artefacts, Documents, evidence, or internal identifiers.
- Do not implement full remote synchronization of `data/`.

## Slice 1: Reliable Existing Workflow

### 1. Verify the complete candidate log during real ingest

Modify:

- `apps/cli/src/main.ts`
- `apps/cli/src/main.test.ts`
- `packages/core/src/verify.ts`
- `packages/core/src/verify.test.ts` if verification rules change

After `prepareIngest` and before `beginIngest`, run `verifyLog` over the existing records plus the
prepared Document and Observations. Pass `knownExtractors`; do not pass retained Artefact hashes for
the not-yet-moved candidate Document.

Requirements:

- Real ingest is the only authoritative admission operation.
- Report every candidate-log verification issue using the existing CLI format.
- Run verification before `beginIngest` and before `commitIngest` can mutate anything.
- Preserve `beginIngest` source-byte and destination checks.
- Preserve rollback and retry behavior.
- Duplicate Artefact bytes fail ingestion.
- Equal retained text alone does not fail ingestion.
- Source `kind` Overrides whose values are absent from `sourceTrustProfiles` fail verification.
- A preparation or full-log verification failure leaves `data/` unchanged.
- Do not add `ingest --dry-run` in this slice.

Add tests for:

- an invalid prepared candidate rejected before any mutation;
- candidate verification reporting multiple issues;
- valid candidate ingestion;
- duplicate Artefact rejection;
- equal text with different Artefact bytes remaining valid;
- source-byte changes and destination collisions still being caught by commit setup;
- rollback behavior remaining unchanged.

### 2. Add structured pending output

Modify:

- `apps/cli/src/main.ts`
- `apps/cli/src/main.test.ts`

Extend the existing `pending` command with:

```sh
pnpm catalogue pending --json [repository]
```

Serialize the existing `PendingArtefact` result in stable filename order. The JSON object for each
file must contain only operational metadata:

```json
{
  "filename": "source.tsv",
  "repositoryRelativePath": "data/inbox/source.tsv",
  "hash": "sha256",
  "artefact": "data/artefacts/source.tsv"
}
```

Requirements:

- `pending` without `--json` preserves current output.
- `--json` emits `[]` and exits zero when there is no pending work.
- Invalid arguments fail with usage and nonzero status.
- Paths and hashes come from `LocalCatalogueData`; do not rescan or duplicate hashing logic.
- Output must not include Document text or private Artefact contents.

### 3. Add the update orchestration skill

Create:

`.claude/skills/update-catalogue/SKILL.md`

The skill orchestrates existing commands and delegates extraction and publication to the existing
skills. It must not copy the rules owned by `extract-document` or `deploy-catalogue`.

Required procedure:

1. Read the repository guidance and the extraction skill.
2. Ask for `PROFILE`, `EXPECTED_ACCOUNT`, and person identity when absent.
3. Use `event-database-inbox` as the default stack name only when the operator confirms it; do not
   silently guess a stack.
4. Run STS with the selected profile and fixed region `us-east-1`.
5. Hard-stop on a root ARN, wrong account, wrong region, unavailable profile, or failed identity.
6. Describe the selected stack and require stable completion plus `DataBucket` and `Region` outputs.
7. Pass the discovered bucket and region inline to inbox pull:

   ```sh
   CATALOGUE_DATA_BUCKET="$DATA_BUCKET" AWS_REGION="$REGION" pnpm catalogue inbox pull
   ```

8. Never use the DataBucket in `deploy-catalogue`; its boundary remains unchanged.
9. Build the CLI if needed, then run `pnpm catalogue pending --json`.
10. Process only files listed as pending and classify each file using `extract-document`.
11. Ask for Source attribution when the file does not establish it. Never invent a slug.
12. Use existing extraction procedures and `pnpm catalogue ingest`.
13. Run `pnpm catalogue verify` after each successful ingest batch.
14. If a new Source kind is established, use the existing `judge` command and a separate judgement
    draft. Do not add a convenience mutation command.
15. Restart safely after interruption by rerunning `pending --json`; successfully ingested files are
    no longer pending, while failed ingests remain retryable.
16. Invoke `deploy-catalogue` only for an explicit publication request.

Stop conditions:

- unknown Source attribution;
- remote/local inbox conflict;
- invalid or missing stack output;
- root principal or wrong account;
- failed ingest or verification;
- unresolved semantic date, time, venue, or Source-kind decision;
- publication requested without explicit confirmation of the exact candidate tree.

The skill must report:

- pulled, already-present, and conflicting inbox files;
- each Document and Observation count ingested;
- every semantic judgement and omitted fact;
- Source-kind judgements recorded through `judge`;
- verification result;
- deployment result when publication is requested.

### 4. Record baseline measurements

The skill should maintain a concise update report in its final output, not in catalogue data. Record
the measurements listed in the Evidence And Scope section. Do not create a new persistent metrics
schema in Slice 1.

## Slice 2: Ao Vivo Adapter, Only After Evidence

Implement only after repeated updates show the Ao Vivo format remains the dominant preparation cost.

Keep it source-specific and initially private to the update workflow. Do not expose generic TSV
support.

The adapter contract must define:

- a fixed, versioned Extractor identity owned by the adapter;
- explicit `person:*` attribution for supplied Source slugs and metadata;
- how the newsletter or sheet title enters retained Document text;
- title-plus-row Spans and a named rule for title-derived dates;
- fatal errors, unresolved semantic questions, and non-fatal diagnostics as separate output;
- behavior for multiple times, multi-day rows, contradictory weekdays, and missing dates;
- Event and Venue Observation generation;
- no caller-controlled Extractor label;
- no silent choice when a row cannot map to the singular `start` or `showtime` fields.

Use synthetic fixtures and compare normalized output with accepted Ao Vivo extraction fixtures after
removing minted IDs and ingestion timestamps. Promote the adapter to a reusable CLI interface only
when another caller or format establishes a real seam.

## Deferred Proposals

Each item requires new measurements, a narrow interface, and an explicit replacement for existing
work before implementation:

- PDF conversion, including dependency, license, resource-limit, security, provenance, and cleanup
  review.
- Source inventory, with current-kind derivation exported from one core policy.
- Deployment HTTP helpers, kept inside `deploy-catalogue` rather than the catalogue CLI.
- Filtered catalogue gates, only if the full gate cost is material and the replacement is explicit.

Do not add `catalogue smoke-site` unless a second deployment consumer needs the same interface.

## Acceptance Criteria

- An operator supplies only an AWS profile, expected account, person identity, and genuinely semantic
  answers.
- Bucket and region values are discovered and passed inline; persistent shell exports are not needed.
- Pending Artefacts are available as stable structured output.
- Any invalid candidate log fails before an Artefact moves or a record appends.
- Real ingest remains authoritative and retry-safe.
- Duplicate Artefact bytes fail; equal retained text alone does not.
- Interrupted runs resume from pending Artefacts without reprocessing ingested bytes.
- Source attribution and ambiguous semantics stop for an answer rather than silently selecting one.
- Publication remains explicit and delegated to `deploy-catalogue`.
- No private source material appears in generated output, diagnostics, fixtures, or tracked temporary
  files.
- Baseline workflow measurements are recorded for later scope decisions.

## TDD Execution Order

1. Add failing tests for candidate-log verification during ingest.
2. Implement verification before `beginIngest` and preserve commit-time checks.
3. Add failing tests for `pending --json`.
4. Implement structured pending serialization without changing default output.
5. Write `update-catalogue/SKILL.md` around the existing commands and safety boundaries.
6. Run the complete workflow once using the skill and record baseline measurements.
7. Review the diff for duplicated policy, accidental interfaces, and private-data leakage.
8. Run:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm catalogue verify
```

## Review Checkpoints

1. After ingest changes, confirm full-log verification happens before filesystem mutation and commit
   still rechecks source bytes and destination absence.
2. After `pending --json`, confirm it serializes existing repository results and adds no new storage
   policy.
3. After the skill, confirm it orchestrates `extract-document` and `deploy-catalogue` without copying
   their rules.
4. Before Slice 2, review the recorded measurements and confirm the Ao Vivo adapter is still the
   smallest justified abstraction.
5. Before merge, run an object-design review on the changed CLI boundary and a security review on the
   new operational skill.
