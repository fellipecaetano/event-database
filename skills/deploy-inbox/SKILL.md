---
name: deploy-inbox
description: Deploy or redeploy the private AWS inbox uploader. Use when asked to deploy, publish, update, prepare, or dry-run `apps/inbox` infrastructure or site assets.
---

# Deploy Inbox Uploader

Deploy the private inbox uploader safely. This skill owns CloudFormation, its Lambda artifact,
the static site publish, and local public browser configuration. It does not destroy resources,
manage Cognito users, or pull the inbox.

Read [README.md](../../README.md), [apps/inbox/AGENTS.md](../../apps/inbox/AGENTS.md), and
[apps/inbox/infra/template.yaml](../../apps/inbox/infra/template.yaml) before acting.

## Modes

Use **dry run** when asked to check, prepare, plan, or preview deployment. Dry run performs every
local, identity, and stack-discovery check below, shows the mutation summary, and stops before
creating a bucket, writing `.env`, uploading an object, deploying a stack, synchronizing the site,
or invalidating CloudFront.

Use **deploy** only when asked to deploy or publish. It must receive the explicit confirmation in
step 5 before its first cloud mutation.

## 1. Establish the deployment identity

Run from the repository root. Read the current commit and working-tree state:

```sh
git rev-parse HEAD
git status --short
aws configure list-profiles
```

Ask the user to select an AWS profile. If a profile has expired SSO credentials, offer and run:

```sh
aws sso login --profile "<profile>"
```

Then validate the selected profile:

```sh
aws sts get-caller-identity --profile "<profile>"
```

**Hard stop** when its ARN is `arn:aws:iam::<account>:root`. Never offer a root override. Ask for
an IAM, assumed-role, or SSO profile instead.

Resolve the region in this order: a region supplied by the user, the profile's configured region,
then a direct question. Always use the selected profile and region explicitly in every AWS command.

```sh
aws configure get region --profile "<profile>"
```

## 2. Discover or derive the deployment

Default names are deterministic:

```text
stack: event-database-inbox
artifact bucket: event-database-inbox-artifacts-<account>-<region>
Cognito domain prefix: event-database-inbox-<account>-<region>
development origin: http://localhost:5173
```

Use existing stack parameters and outputs rather than deriving new names on an update:

```sh
aws cloudformation describe-stacks --profile "<profile>" --region "<region>" \
  --stack-name "<stack>"
```

If the stack does not exist, use defaults unless the user explicitly supplies an override. If its
status ends in `_IN_PROGRESS`, or is a rollback/deletion state, stop and report it rather than
racing CloudFormation.

For an artifact bucket that already exists, verify access, ownership, and region. Treat a 403 or a
different region as a hard conflict. Never empty or replace an existing bucket.

## 3. Validate locally

Before any cloud mutation, run:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
aws cloudformation validate-template --profile "<profile>" --region "<region>" \
  --template-body file://apps/inbox/infra/template.yaml
```

If any command fails, stop. Do not deploy an unvalidated build.

If `git status --short` is not empty, list those paths and ask whether to deploy the exact dirty
tree. Stop unless the user confirms.

## 4. Prepare the artifact

Build the Lambda locally:

```sh
pnpm --filter @event-database/inbox build:lambda
```

Hash the uncompressed handler and use the hash in the remote object key. This avoids ZIP timestamp
churn and makes unchanged artifacts reusable:

```sh
shasum -a 256 apps/inbox/dist/lambda/create-upload-intents.mjs
```

The artifact key is:

```text
inbox/create-upload-intents/<handler-sha256>.zip
```

Set the key. Check whether it already exists only when the artifact bucket already exists; a new
bucket necessarily needs an upload after confirmation:

```sh
HANDLER_SHA256="$(shasum -a 256 apps/inbox/dist/lambda/create-upload-intents.cjs | cut -d ' ' -f 1)"
ARTIFACT_KEY="inbox/create-upload-intents/$HANDLER_SHA256.zip"
aws s3api head-object --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>" --key "$ARTIFACT_KEY"
```

A `Not Found` result means the deployment will upload the ZIP; an existing object is reused. A
missing bucket is not an error in this step: record that it will be created after confirmation.

## 5. Confirm cloud mutations

Before acting, show and ask approval for this complete summary:

```text
AWS account and principal
AWS profile and region
Current commit and whether the tree is dirty
Create or update stack
Artifact bucket and whether it will be created
Content-addressed Lambda key and whether it will upload
Cognito domain prefix
CloudFormation stack name
Website bucket synchronization with --delete
CloudFront invalidation
Writing ignored apps/inbox/.env
```

Do not proceed without explicit confirmation.

## 6. Create or verify the artifact bucket

Only create the deterministic artifact bucket when it does not exist. Handle `us-east-1` without a
location constraint. Apply public-access blocking, SSE-S3 encryption, and versioning. For an
existing bucket, inspect these controls and stop if public access is possible; do not silently
weaken or replace its configuration.

For a new bucket, run the appropriate creation command, followed by these controls:

```sh
if [ "<region>" = us-east-1 ]; then
  aws s3api create-bucket --profile "<profile>" --region "<region>" \
    --bucket "<artifact-bucket>"
else
  aws s3api create-bucket --profile "<profile>" --region "<region>" \
    --bucket "<artifact-bucket>" \
    --create-bucket-configuration LocationConstraint="<region>"
fi
aws s3api put-public-access-block --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>" --versioning-configuration Status=Enabled
```

For an existing bucket, inspect instead:

```sh
aws s3api get-bucket-location --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>"
aws s3api get-public-access-block --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>"
aws s3api get-bucket-encryption --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>"
aws s3api get-bucket-versioning --profile "<profile>" --region "<region>" \
  --bucket "<artifact-bucket>"
```

Never create, upload, or modify any data-bucket object here.

## 7. Upload and deploy the stack

Upload only the generated Lambda ZIP at the content-addressed key when absent:

```sh
aws s3 cp apps/inbox/dist/lambda/create-upload-intents.zip \
  "s3://<artifact-bucket>/$ARTIFACT_KEY" \
  --profile "<profile>" --region "<region>"
```

Then deploy:

```sh
aws cloudformation deploy --profile "<profile>" --region "<region>" \
  --stack-name "<stack>" --template-file apps/inbox/infra/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides CognitoDomainPrefix="<prefix>" \
  DevelopmentOrigin="<development-origin>" \
  LambdaCodeBucket="<artifact-bucket>" LambdaCodeKey="$ARTIFACT_KEY" \
  --tags Project=event-database ManagedBy=deploy-inbox
```

On failure, retrieve recent stack events and report them. Do not delete the stack, buckets, or
uploaded artifact.

## 8. Build and publish the browser

Read stack outputs in one call, then derive each required value from its `OutputKey`:

```sh
aws cloudformation describe-stacks --profile "<profile>" --region "<region>" \
  --stack-name "<stack>" --query "Stacks[0].Outputs" --output json
```

Create or update the ignored `apps/inbox/.env` with only public values using `apply_patch`:

```dotenv
VITE_API_URL=<ApiUrl>
VITE_COGNITO_AUTHORITY=<CognitoAuthority>
VITE_COGNITO_CLIENT_ID=<CognitoClientId>
```

Build the site:

```sh
pnpm --filter @event-database/inbox build:site
```

Publish assets and HTML separately. The site sync is allowed to delete obsolete objects only in the
stack's `WebsiteBucket`; never point it at the data or artifact bucket.

```sh
aws s3 sync apps/inbox/dist/site/assets/ "s3://<website-bucket>/assets/" \
  --delete --cache-control "public,max-age=31536000,immutable"
aws s3 sync apps/inbox/dist/site/ "s3://<website-bucket>/" --delete \
  --exclude "assets/*" --cache-control "no-cache"
```

Create a `/*` invalidation, wait for it to complete, and retain its ID for the report.

```sh
INVALIDATION_ID="$(aws cloudfront create-invalidation --profile "<profile>" \
  --distribution-id "<distribution-id>" --paths '/*' \
  --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --profile "<profile>" \
  --distribution-id "<distribution-id>" --id "$INVALIDATION_ID"
```

## 9. Smoke test and report

Verify all of the following:

- The stack reaches `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
- The CloudFront distribution reports `Deployed`.
- `WebsiteUrl` returns the application.
- An unauthenticated `POST <ApiUrl>/upload-intents` returns 401.
- Unauthenticated S3 access to the data bucket returns AccessDenied.
- Data-bucket public-access blocking remains enabled.

Use `curl` for the public endpoints and `aws s3api get-object --no-sign-request` with an arbitrary
probe key for anonymous data-bucket access. The API check is successful only for HTTP 401; the S3
check is successful only when AWS returns `AccessDenied`. Do not accept a network failure as a
security result.

Report the website URL, stack status, account, profile, region, data bucket, artifact reuse/upload
status, invalidation result, and whether `.env` was written. Include:

```sh
pnpm --filter @event-database/inbox dev
AWS_PROFILE="<profile>" AWS_REGION="<region>" \
CATALOGUE_DATA_BUCKET="<data-bucket>" pnpm catalogue inbox pull
```

Self-registration is disabled. Do not create users. Report the `UserPoolId` output and say that an
administrator must create uploaders through Cognito separately.

## Never

- Never deploy with root credentials.
- Never proceed through an unconfirmed dirty deployment.
- Never delete a CloudFormation stack, bucket, user, artifact, or data object.
- Never serve, copy, or synchronize retained Artefacts into the website bucket.
- Never log credentials, tokens, or presigned URLs.
