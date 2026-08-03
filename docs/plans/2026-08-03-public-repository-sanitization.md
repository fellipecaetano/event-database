# Public repository sanitization plan

## Goal

Publish the source code without exposing retained source material, catalogue logs, private
Judgements, local deployment configuration, credentials, or recoverable sensitive Git objects.
The existing local repository remains disconnected from GitHub and retains ignored private
`data/`, which has a separate complete S3 backup.

## Fixed decisions

- The sanitized public clone becomes the source-code authority after publication.
- Preserve existing author and committer identities exactly.
- Remove historical `data/` and `examples/` from every published ref. Do not publish the deleted
  `interactive-review` branch.
- Keep reviewed public facts, short examples, Source names, and aggregate statistics. Remove
  retained Artefacts, logs, private Judgements, unnecessary precise addresses, personal handles,
  long verbatim source text, credentials, and private bucket identifiers.
- Keep the inbox infrastructure as internal reference code, not supported deployment tooling.
- Use no license. State this plainly in the README.
- Include `.opencode/agents/software-security-auditor.md`.
- Apply aggregate upload limits, inbox lifecycle retention, and CloudWatch alarms. Do not add
  principal-level quota storage.
- Browser-visible API, Cognito, and CloudFront identifiers are not credentials, but public source
  configuration uses placeholders only.

## Phase 1: make a public checkout data-free

1. Replace production-log schema tests with committed synthetic fixtures outside `data/`.
2. Treat absent log stream directories as an empty catalogue, allowing `catalogue verify` to
   succeed in a fresh checkout.
3. Add regression coverage for the empty catalogue behavior.
4. Update setup documentation to distinguish an empty public checkout from the private catalogue.

Acceptance criteria:

- `pnpm check` succeeds in a fresh checkout with no ignored files.
- No test reads production data.
- `pnpm catalogue verify` reports zero records when `data/` is absent.

## Phase 2: harden the upload boundary

1. Bind each validated `file.size` to `PutObjectCommand.ContentLength`.
2. Keep `If-None-Match: *` signed.
3. Configure the S3 client not to presign an empty-body checksum that a browser cannot satisfy.
4. Add a signing test with synthetic credentials that asserts signed `content-length` and
   `if-none-match`, and the absence of an inferred empty-body checksum.
5. Keep the per-object 25 MiB limit and add a 50 MiB aggregate intent limit.
6. Add a 30-day `inbox/` expiry and 7-day noncurrent inbox-version expiry. Retained Artefacts
   remain outside this prefix.
7. Add CloudWatch object-count and storage-growth alarms. Require a monitored private SNS topic
   ARN for alarm actions before deploying these controls.

Acceptance criteria:

- The signer receives the validated content length.
- Length and collision constraints are in the signed request.
- A matching browser upload is not rejected by an unusable empty-body checksum.
- Oversized files and aggregate requests are rejected before signing.

The selected baseline deliberately does not impose per-user quotas. An administrator-created or
compromised uploader can still consume storage across repeated requests; lifecycle cleanup and
actionable alarms reduce, but do not prevent, that risk. Revisit principal-level quotas if the
uploader is shared beyond a small trusted group.

## Phase 3: keep OIDC tokens session-only

1. Keep transient callback state in `localStorage` so mobile browser handoffs can return to it.
2. Store the OIDC user, access token, ID token, and refresh token in `sessionStorage`.
3. Remove all legacy `oidc.user:` records from local storage during startup.
4. Add unit coverage for legacy-record removal without deleting callback state.
5. Keep the existing mobile authentication smoke test as a release check; add a browser callback
   lifecycle test before treating the uploader as externally supported.

Acceptance criteria:

- Persistent browser storage contains no OIDC user/token record.
- Callback state remains available during the authorization redirect.

## Phase 4: add durable public-repository controls

1. Add `SECURITY.md` with private GitHub vulnerability reporting instructions.
2. State the no-license policy in the README.
3. Add CI for formatting, linting, type checks, unit tests, build, empty-catalogue verification,
   Playwright, production dependency audit, and secret scanning.
4. Fail CI when tracked paths include `data/`, `examples/`, `.env` files other than examples, or
   generated output.
5. Enable branch protection, required CI checks, GitHub secret scanning, push protection, and
   private vulnerability reporting after the GitHub repository is created.

## Phase 5: prepare the private release candidate

1. Review all modified and untracked files, then commit intended public source changes.
2. Confirm a clean worktree, only approved branches/tags, and no `interactive-review` ref.
3. Manually review documentation, tests, skills, and commit messages against the public-content
   boundary. Do not rely on secret scanning to classify source material.
4. Save a private manifest of every blob historically reachable under `data/` or `examples`, the
   expected ref list, the approved content inventory, and pinned tool versions. Do not print blob
   contents.

## Phase 6: create a disposable sanitized mirror

1. Create a private `git clone --mirror --no-local` outside the workspace.
2. Use a pinned `git-filter-repo` to remove `data/`, `examples/`, and `docs/sessions/` with
   default empty-commit pruning. Apply only explicitly approved historical text replacements.
3. Do not alter author or committer metadata, restore deleted refs, or add a GitHub remote to the
   original repository.
4. Preserve the filter-repo commit/ref maps outside the repository. Review every pruned commit.

## Phase 7: verify the mirror

Before garbage collection:

1. Intersect the private blob manifest with `git rev-list --objects --all`; no sensitive blob may
   be reachable.
2. Confirm forbidden paths, live environment values, and unexpected refs are absent.
3. Compare the sanitized tip tree with the source tip minus approved exclusions.
4. Run pinned Gitleaks with redacted output and complete the manual public-content review.

Then expire reflogs, run `git gc --prune=now`, and use `git cat-file -e` to confirm sensitive
blob IDs are physically absent. Run `git fsck --full --unreachable` afterwards.

## Phase 8: validate and publish

1. Clone the sanitized mirror into a second private directory and run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm --filter @event-database/inbox test:e2e
   pnpm audit --prod --audit-level high
   git fsck --full
   ```

2. Create a new empty private GitHub repository.
3. Add its remote only to the sanitized clone, push sanitized `main`, and clone GitHub into a third
   private directory.
4. Repeat the path, object, secret, content, build, and test checks against that clone.
5. Enable GitHub protections, then make the repository public only after every check passes.

## Ongoing workflow

- Develop source code from the sanitized public-history clone.
- Keep private `data/` ignored locally and backed up to S3. Do not add the GitHub remote to this
  original repository.
- Run private catalogue commands explicitly against the local catalogue path when needed.
- Deploy only reviewed commits from public `main`.
- If a credential is ever found, rotate it immediately; history rewriting is not a substitute for
  revocation.
