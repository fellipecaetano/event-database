---
name: deploy-catalogue
description: Build and publish the public catalogue assets to the existing healthy AWS deployment. Use for catalogue site releases, previews, or dry-runs.
---

# Deploy Catalogue

Build and publish catalogue assets only. This skill never creates, updates, or deletes
CloudFormation, Route53, ACM, CloudFront configuration, Lambda, or inbox assets. It may read stack
outputs and distribution state; it may mutate only objects in `CatalogueBucket` and create a
CloudFront invalidation. It never accesses `DataBucket` or `WebsiteBucket`.

Work from the repository root. Use **dry-run** for preview/check requests and **deploy** only for an
explicit `update`, `refresh`, `deploy`, or `publish` request, including authorization delegated by
`update-catalogue`. That request authorizes the normal bounded mutation defined below; do not ask the
operator to approve it a second time. Dry-run performs discovery, checks, and a local build, then
reports the planned sync without uploading, deleting, or invalidating.

## Establish The Gate

Use passed, already validated context from `update-catalogue`, or read the ignored repository-root
`.catalogue.local.json`. It supplies the expected account, region, preferred profile, and stack name.
Use the preferred profile when it exists and resolves to the expected non-root account; otherwise
select the unique configured non-root profile for that account. Ask only when the file or a required
value is missing, or profile selection is ambiguous. Every AWS command must include the selected
profile and configured region. Validate identity with STS and hard stop for a root ARN, wrong
account, or wrong region. Record the commit and `git status --short`; list dirty paths and ask before
publishing a dirty tree.

Discover the existing stack with `describe-stacks`. Require a complete, stable stack, no active
operation, healthy deployed distribution, and outputs `CatalogueBucket`, `CatalogueUrl`,
`InboxUrl`, `DistributionId`, and `DistributionDomainName`. Hard stop if discovery fails or any
output is missing. Read no `DataBucket` or `WebsiteBucket` output and issue no S3 command against
either bucket.

## Check And Build

Run the full local gate:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm catalogue verify
```

Create a fresh temporary parent with `mktemp -d`; set `OUTPUT` to a nonexistent child within it so
the builder's ownership protection remains effective. Build exactly:

```sh
pnpm catalogue build-site --output "$OUTPUT" --site-name "Música em SP" --base-url "https://musicaemsp.com.br"
```

Inspect the output for `.event-database-site.json`, generated routes, links, and absence of private
Documents, evidence, retained Artefacts, and internal IDs. Serve the temporary output locally and
smoke-test the homepage and every generated HTML route. Remove the temporary directory when the
run finishes.

## Inspect And Publish

Show account/principal, profile, fixed region, commit/dirty state, healthy stack and distribution,
literal `CatalogueBucket`, generated route count, exact sync scope, delete behavior, cache policy,
and invalidation paths in progress output. Run the exact S3 sync command with `--dryrun` first and
inspect every planned upload and deletion. Proceed without another confirmation when the tree is
clean and the plan is confined to replacing generated catalogue assets in the literal
`CatalogueBucket` root. Ask when the plan contains an unexpected object, destination, deletion, or
scope change.

```sh
aws s3 sync "$OUTPUT/" "s3://$CATALOGUE_BUCKET/" --delete --exclude ".event-database-site.json" --cache-control "no-cache" --dryrun --profile "$PROFILE" --region us-east-1
```

Expected keys are the generated root files and content beneath `assets/`, `events/`, and `past/`.
Treat a planned deletion outside those generator-owned paths as unexpected.

Sync only to the root of `CatalogueBucket`. The ownership marker is local-only and must be excluded.
Generated asset names are stable, so all published paths must revalidate rather than use immutable
caching:

```sh
aws s3 sync "$OUTPUT/" "s3://$CATALOGUE_BUCKET/" --delete --exclude ".event-database-site.json" --cache-control "no-cache" --profile "$PROFILE" --region us-east-1
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --profile "$PROFILE" --region us-east-1
```

Wait for invalidation completion using the returned ID. Never use a broader S3 destination, and
never upload the marker.

## Verify And Report

Smoke-test the apex homepage and every generated route over HTTPS, verify expected revalidation
headers, verify `/inbox/` still loads, and verify `https://www.musicaemsp.com.br/...` redirects to
the equivalent apex URL. A network failure is not a passing result.

Report account/profile/region, commit and dirty state, stack/distribution health, bucket, route and
object scope, deletion/cache behavior, invalidation ID/status, and every smoke-test result. Report
dry-run explicitly as no cloud mutation.
