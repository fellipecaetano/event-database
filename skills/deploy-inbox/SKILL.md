---
name: deploy-inbox
description: Deploy or dry-run the AWS infrastructure, shared distribution, and private inbox application. Use for CloudFormation, Route53, ACM, Lambda, or inbox asset changes.
---

# Deploy Inbox

This skill is the sole owner of the CloudFormation stack, shared CloudFront distribution,
Route53, ACM, Lambda artifact, and inbox assets. It may inspect `CatalogueBucket` but leaves
catalogue publishing to `deploy-catalogue`. It never manages Cognito users or inbox data.

Read `../../../README.md`, `../../../apps/inbox/AGENTS.md`, and
`../../../apps/inbox/infra/template.yaml`. Work from the repository root.

## Mode And Identity

Use **dry-run** for check, prepare, plan, or preview requests. Complete discovery, local checks,
artifact preparation, and change-set inspection, then stop before execution, uploads, asset sync,
invalidation, DNS delegation, or writing `.env`. Creating a CloudFormation change set is the only
dry-run cloud mutation and requires confirmation.

Use **deploy** only for an explicit deploy or publish request. Every AWS command must include
`--profile "$PROFILE" --region us-east-1`; this deployment has no other valid region. Ask the user
to select `PROFILE`, log in if needed, then run:

```sh
aws sts get-caller-identity --profile "$PROFILE" --region us-east-1
```

Hard stop when the ARN is `arn:aws:iam::<account>:root`; there is no override. Record the commit
and `git status --short`. List dirty paths and hard stop unless the user explicitly confirms that
exact dirty tree.

## Discover Existing State

Use the deployed stack as source of truth; default a new stack to `event-database-inbox`.

```sh
aws cloudformation describe-stacks --stack-name "$STACK" --profile "$PROFILE" --region us-east-1
aws cloudformation describe-stack-termination-protection --stack-name "$STACK" --profile "$PROFILE" --region us-east-1
aws cloudformation list-stack-resources --stack-name "$STACK" --profile "$PROFILE" --region us-east-1
aws cloudformation detect-stack-drift --stack-name "$STACK" --profile "$PROFILE" --region us-east-1
aws route53 list-hosted-zones-by-name --dns-name musicaemsp.com.br --profile "$PROFILE" --region us-east-1
```

Poll `describe-stack-drift-detection-status`, then inspect `describe-stack-resource-drifts`.
Record status, drift, termination protection, outputs, parameters, every physical resource ID,
distribution status/config, certificate status, hosted-zone name servers, and apex/www A and AAAA
records. Use `list-hosted-zones-by-name` before deciding whether the domain stack is absent; stop
if a matching zone exists with unclear ownership. Query its records only after discovering its id. Stop on stack
progress/rollback/deletion, drift, unhealthy resources, wrong account/region, or DNS records
targeting an unexpected distribution. For a new stack, report these checks as not yet applicable.
If termination protection is disabled, include enabling it as a separately confirmed mutation
before creating the application change set; do not treat the pre-migration state as unexplained
drift.

Verify public-access blocks and bucket policies for `DataBucket`, `WebsiteBucket`, and
`CatalogueBucket`; inspect the artifact bucket too when present. Hard stop if any S3 bucket is
public. Do not read or write data objects or catalogue objects.

## Validate And Prepare

Run before cloud mutation:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm catalogue verify
aws cloudformation validate-template --template-body file://apps/inbox/infra/template.yaml --profile "$PROFILE" --region us-east-1
aws cloudformation validate-template --template-body file://apps/inbox/infra/domain-template.yaml --profile "$PROFILE" --region us-east-1
pnpm --filter @event-database/inbox build:lambda
HANDLER_SHA256="$(shasum -a 256 apps/inbox/dist/lambda/create-upload-intents.cjs | cut -d ' ' -f 1)"
ARTIFACT_KEY="inbox/create-upload-intents/$HANDLER_SHA256.zip"
```

The handler is `.cjs` everywhere. Never hash or package a `.mjs` path. Use the existing stack's
artifact bucket and parameters on update; for a new stack use
`event-database-inbox-artifacts-<account>-us-east-1`. Inspect ownership, region, encryption,
versioning, public-access block, and whether `ARTIFACT_KEY` exists. A conflict is a hard stop.

## Change Set Gate

When no hosted zone exists, deploy `domain-template.yaml` first as a dedicated
`event-database-domain` stack after explicit confirmation. Wait for completion, show its name
servers, and stop at the registrar delegation gate. Continue only after authoritative DNS resolves
those name servers. Pass its `HostedZoneId` and comma-separated `HostedZoneNameServers` outputs to
the application stack; this ordering lets ACM DNS validation complete instead of deadlocking on an
undelegated zone. Never remove or replace the retained domain stack.

Before creating a change set, summarize account/principal, profile, fixed region, commit/dirty
state, stack status/drift/termination protection, artifact creation or upload, parameters, Lambda
key, infrastructure resources affected, inbox asset destinations, `.env`, invalidation, and DNS
delegation state. Ask for explicit confirmation to create the change set.

Create a uniquely named `CREATE` or `UPDATE` change set with the template, complete parameter set,
tags, and `CAPABILITY_IAM`; do not use `aws cloudformation deploy`. Wait for creation and inspect:

```sh
aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET" --include-property-values --profile "$PROFILE" --region us-east-1
```

Hard stop on:

- removal or replacement of `DataBucket`, `UserPool`, `UserPoolClient`, `WebsiteBucket`, or
  `Distribution`;
- S3 public access or a policy that permits public access;
- unexpected IAM action, resource, principal, wildcard, or privilege broadening;
- any unexplained replacement, deletion, retained-resource change, or security weakening.

Show the complete reviewed changes and a second mutation summary: artifact bucket/object writes,
change-set execution, inbox sync prefixes and deletes, `.env`, invalidation, and registrar action.
Dry-run stops here. Deploy requires explicit confirmation before execution.

## Stage Inbox Assets

Before executing a change set that moves the inbox from the distribution root, write the ignored
`.env`, build the site, and synchronize the literal `inbox/` prefixes using the commands below.
The existing broad website policy can serve these staged objects after cutover. Require explicit
confirmation because staging mutates S3. Verify the objects exist before changing the distribution;
leave all legacy root objects available for template rollback.

## Execute Infrastructure

Create a missing artifact bucket only after confirmation; in `us-east-1` omit
`LocationConstraint`. Immediately enable all four public-access blocks, SSE-S3 encryption, and
versioning. Upload only `apps/inbox/dist/lambda/create-upload-intents.zip` to the content-addressed
artifact key when absent. Never empty or replace the bucket.

Execute the approved change set, wait for stack completion, and report failed events without
deleting or rolling back retained resources. Re-run all discovery and security checks. Require the
expected physical IDs to remain unchanged and the distribution to reach `Deployed`.

Registrar delegation must already be complete before the application change set. Never alter it
implicitly.

## Publish Inbox Assets

Read fresh outputs once. If this is not the initial migration, write ignored `apps/inbox/.env` with
only `ApiUrl`, `CognitoAuthority`, and `CognitoClientId`, then run
`pnpm --filter @event-database/inbox build:site`.

The literal destinations are `s3://$WEBSITE_BUCKET/inbox/assets/` and
`s3://$WEBSITE_BUCKET/inbox/`. Constrain `--delete` to those prefixes:

```sh
aws s3 sync apps/inbox/dist/site/assets/ "s3://$WEBSITE_BUCKET/inbox/assets/" --delete --cache-control "public,max-age=31536000,immutable" --profile "$PROFILE" --region us-east-1
aws s3 sync apps/inbox/dist/site/ "s3://$WEBSITE_BUCKET/inbox/" --delete --exclude "assets/*" --cache-control "no-cache" --profile "$PROFILE" --region us-east-1
```

During initial migration, leave all legacy root objects untouched. Never sync or delete at the
`WebsiteBucket` root. Invalidate `/inbox` and `/inbox/*`, wait for completion, and retain the ID.

## Verify And Report

Smoke-test both rollback paths before declaring success:

- `https://musicaemsp.com.br/inbox/` and
  `https://<DistributionDomainName>/inbox/` load the inbox application;
- static assets load through both hosts and use the expected cache controls;
- unauthenticated `POST <ApiUrl>/upload-intents` returns HTTP 401;
- anonymous data-bucket access returns `AccessDenied`, not a network error;
- all buckets remain private, TLS/security headers are present, and HTTP redirects to HTTPS;
- apex catalogue remains reachable and `www` redirects to the apex.

Report stack/change-set status, stable physical IDs, account/profile/region, drift and termination
protection, DNS/certificate/distribution state, artifact reuse/upload, exact inbox prefixes changed,
invalidation result, `.env`, smoke tests, and security checks. Self-registration stays disabled;
report `UserPoolId` for separate administrator provisioning.

Never delete a stack, bucket, user, data object, catalogue object, retained artifact, or legacy
root website object. Never log credentials, tokens, or presigned URLs.
