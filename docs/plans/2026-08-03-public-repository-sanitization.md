# Public repository sanitization plan

## Goal

Publish the project without exposing retained source material, catalogue data, local deployment
configuration, credentials, or recoverable sensitive Git objects, while preserving as much useful
Git history as possible.

The existing repository remains the private source of record. Perform the rewrite in a disposable
mirror and publish only the verified rewritten repository.

## Fixed decisions

- Preserve existing author and committer names and email addresses exactly. GitHub attribution is
  intentional. Do not use a mailmap, metadata callbacks, or email replacement.
- The deleted `interactive-review` branch must not be restored or published.
- Remove all historical `data/` and `examples/` content from every published ref.
- Use default empty-commit pruning. A commit whose only public effect was sensitive data does not
  need to remain as an empty commit.
- Do not publish by copying or archiving the working directory. It contains ignored private data
  and live deployment configuration.
- Do not modify or connect the original private repository to the public GitHub remote.

## Publication blockers being addressed

Historical commits contain retained images, HTML and tabular source exports, Documents,
Observations, and Judgements beneath `data/` and earlier beneath `examples/`. Removing those paths
from the current tree did not remove their Git objects.

The working directory also contains ignored material that must not be published:

- `data/`
- `apps/inbox/.env`
- `apps/inbox/dist/`
- `.build/` and other generated or cached output

The local environment values are browser-visible deployment identifiers rather than AWS
credentials, but they identify the live private deployment and must not enter the public source
repository accidentally.

## Phase 1: prepare the private source repository

1. Run `git status --short` and review every modified and untracked path.
2. Decide whether `.opencode/agents/software-security-auditor.md` belongs in the public project.
3. Commit the intended source changes privately so `HEAD` is the exact release candidate. Never
   use `git add -f` for an ignored path.
4. Confirm the working tree is clean.
5. Confirm only the intended branch and tags remain:

   ```sh
   git branch --list
   git tag --list
   git for-each-ref
   ```

6. Confirm there is no `interactive-review` ref under heads, remotes, tags, or another namespace.
7. Keep the original repository and its ignored `data/` directory private.

Acceptance criteria:

- `HEAD` contains all intended public source changes.
- The working tree is clean.
- No `interactive-review` ref exists.
- No ignored private file has been force-added.

## Phase 2: fix the upload-size enforcement gap

The API validates a client-declared 25 MiB size but does not bind that value to the presigned S3
PUT. An authenticated uploader can declare a small file and upload a much larger object.

Follow TDD:

1. Update `apps/inbox/functions/create-upload-intents.test.ts` first. The existing signing test
   must expect `signUpload` to receive `contentLength: 12` for its 12-byte fixture.
2. Run the test and confirm it fails for the missing field.
3. Add `contentLength` to the `signUpload` dependency input in
   `apps/inbox/functions/create-upload-intents.ts`.
4. Pass the validated `file.size` to `signUpload`.
5. Set `ContentLength` on `PutObjectCommand`.
6. Do not instruct browser JavaScript to set `Content-Length`; browsers control that forbidden
   header. The actual browser-supplied length must match the signed value.
7. Add a presigner contract test using synthetic credentials. Assert that the generated URL's
   signed-header list includes `content-length`.
8. Preserve the signed `If-None-Match: *` collision protection.
9. Add or retain boundary tests for exactly 25 MiB and 25 MiB plus one byte.

Acceptance criteria:

- The validated length reaches `PutObjectCommand.ContentLength`.
- A mismatched actual upload length invalidates the request signature in an isolated integration
  test or equivalent S3-compatible test.
- Matching uploads and collision protection still work.

## Phase 3: stop persistent OIDC token storage

`apps/inbox/src/main.tsx` currently stores both callback state and the authenticated OIDC user in
`localStorage`, contrary to `apps/inbox/AGENTS.md`.

Follow TDD and preserve the mobile callback behavior:

1. Add a failing browser test that requires the authenticated user record to use
   `sessionStorage` and asserts that no OIDC user/token record exists in `localStorage`.
2. Keep temporary callback `stateStore` in `localStorage` if the mobile redirect flow requires it.
3. Change only `userStore` to `sessionStorage` or an in-memory store.
4. Remove the legacy `oidc.user:<authority>:<client-id>` entry from `localStorage` during the
   migration so previously stored tokens are not left behind.
5. Verify callback state is consumed and removed normally.

Acceptance criteria:

- Access, ID, and refresh tokens are absent from `localStorage`.
- Authentication still works after the redirect and for the lifetime of the browser session.
- The existing mobile callback behavior remains working.

## Phase 4: record sensitive historical blob IDs

Before rewriting, create a private manifest of every blob ever stored under `data/` or
`examples/`. Store it outside the repository and never publish it.

```sh
git rev-list --all |
while read -r commit; do
  git ls-tree -r "$commit" -- data examples
done |
awk '$2 == "blob" {print $3}' |
sort -u > "/private/location/event-database-sensitive-blob-ids.txt"
```

Also save the expected ref inventory outside the repository:

```sh
git for-each-ref --format='%(refname)' \
  > "/private/location/event-database-expected-refs.txt"
```

Do not print or inspect the contents of sensitive blobs while creating these manifests.

## Phase 5: create and rewrite a disposable mirror

Create the mirror somewhere private and outside the project workspace:

```sh
git clone --mirror --no-local \
  "/Users/fellipe/Projects/event-database" \
  "/private/temp/event-database-public.git"
```

Inspect its refs before proceeding. Delete any stale `interactive-review` ref if one unexpectedly
appears. Do not delete `main` or intended tags.

Install and use `git-filter-repo`; do not use `git filter-branch` or BFG:

```sh
git -C "/private/temp/event-database-public.git" filter-repo \
  --invert-paths \
  --path data/ \
  --path examples/
```

Do not add any of these options:

- `--mailmap`
- author or committer callbacks
- email replacement
- `--prune-empty never`
- `--prune-degenerate never`

Expected consequences:

- Author names, author emails, committer names, committer emails, messages, and dates remain unless
  a commit is pruned because it no longer changes any public file.
- Commits at and after the first rewritten commit receive new hashes.
- Existing commit or tag signatures become invalid.
- External links to rewritten commit hashes stop resolving.

## Phase 6: verify the rewritten object database

Run every check against the disposable mirror before adding a GitHub remote.

### Paths and refs

```sh
git -C "/private/temp/event-database-public.git" log --all -- data examples
git -C "/private/temp/event-database-public.git" rev-list --objects --all
git -C "/private/temp/event-database-public.git" for-each-ref
```

Acceptance criteria:

- The path-limited log prints nothing.
- The object listing contains no `data/`, `examples/`, live `.env`, generated deployment output,
  or unexpected sensitive path.
- No `interactive-review`, original-history backup, or other unexpected ref exists.
- Only `main` and individually approved tags remain for publication.

### Historical blob removal

For every object ID in the private sensitive-blob manifest, `git cat-file -e` must fail in the
rewritten mirror. Automate the loop without printing blob contents. If any sensitive blob still
exists, identical content remains reachable through another path; stop and locate that path before
publication.

After the reachability checks pass:

```sh
git -C "/private/temp/event-database-public.git" reflog expire \
  --expire=now --all
git -C "/private/temp/event-database-public.git" gc --prune=now
git -C "/private/temp/event-database-public.git" fsck \
  --full --unreachable
```

No sensitive unreachable object should remain.

### Attribution

Verify that author and committer metadata still use the intended identities:

```sh
git -C "/private/temp/event-database-public.git" log --all \
  --format='%an <%ae> | %cn <%ce>'
```

Do not redact or replace the intended author email. Confirm that GitHub has that email verified so
the rewritten commits are attributed to the correct account.

### Secret scanning

Run a dedicated scanner such as Gitleaks against all rewritten history with redaction enabled.
Separately scan commit messages and path names for:

- AWS access keys and session tokens
- private keys
- GitHub or other service tokens
- credential-bearing URLs
- live S3 bucket names
- real AWS account IDs
- real API Gateway, Cognito, and CloudFront identifiers
- unexpected personal or source data

Do not print detected values. Report only the secret type and location.

## Phase 7: validate a normal checkout

Clone the rewritten mirror into another private temporary directory:

```sh
git clone "/private/temp/event-database-public.git" \
  "/private/temp/event-database-public-validation"
```

In that checkout:

1. Confirm no `data/`, `examples/`, live `.env`, build output, or cache is tracked.
2. Confirm `.env.example` contains placeholders only.
3. Repeat the redacted filesystem and Git-history secret scans.
4. Run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm audit --prod
   git fsck --full
   ```

5. Review representative commits from before, during, and after the former sensitive-data period.
6. Confirm the uploader fixes and their tests are present.
7. Confirm README instructions remain accurate.

Do not proceed while any check fails.

## Phase 8: publish conservatively

1. Create a new empty GitHub repository with private visibility.
2. Add that remote only to the sanitized mirror or its validation checkout. Never add it to the
   original repository.
3. Push only sanitized `main` initially. Do not use `--mirror`, `--all`, or force-push.
4. Do not publish `interactive-review`.
5. Push an approved tag only after reviewing that tag's rewritten history.
6. Clone the GitHub repository into a third temporary directory.
7. Repeat the forbidden-path, sensitive-blob, ref, attribution, secret-scan, and `git fsck` checks
   against the GitHub clone.
8. Enable GitHub secret scanning and push protection where available.
9. Change repository visibility to public only after the GitHub clone passes every check.

## Stop conditions

Stop without publishing if any of these occurs:

- A recorded sensitive blob remains reachable.
- `data/` or `examples/` appears in any published ref.
- A live `.env`, generated browser bundle, credential, token, private key, data-bucket name, or
  unexpected deployment identifier is tracked.
- An unexpected original-history or deleted-branch ref survives.
- The upload size is not cryptographically bound to the S3 request.
- OIDC tokens remain in persistent browser storage.
- Tests, type checking, linting, formatting, build, dependency audit, or secret scanning fails.

## Security controls to preserve

- Data-bucket public-access blocking and TLS-only policy
- Separate website and data buckets
- Cognito admin-only account creation
- JWT authorization on the upload route
- Lambda IAM restricted to `s3:PutObject` under `inbox/*`
- Five-minute presigned URL lifetime
- Signed `If-None-Match: *` overwrite prevention
- Filename and path validation
- Exact-version deletion during inbox pull
- AWS provider-chain credentials instead of embedded credentials
- Ignoring local data, environment files, build output, and caches
