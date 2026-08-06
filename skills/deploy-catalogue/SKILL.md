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
explicit publish request. Dry-run performs discovery, checks, and a local build, then reports the
planned sync without uploading, deleting, or invalidating.

## Establish The Gate

Select `PROFILE`; every AWS command must include `--profile "$PROFILE" --region us-east-1`.
Validate identity with STS and hard stop for a root ARN, wrong account, or any region other than
`us-east-1`. Record the commit and `git status --short`; list dirty paths and stop unless the user
explicitly confirms publishing that exact tree.

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

## Confirm And Publish

Show account/principal, profile, fixed region, commit/dirty state, healthy stack and distribution,
literal `CatalogueBucket`, generated route count, exact sync scope, delete behavior, cache policy,
and invalidation paths. Require explicit confirmation before the first mutation.

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
