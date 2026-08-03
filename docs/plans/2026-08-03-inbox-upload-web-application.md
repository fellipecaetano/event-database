# Inbox Upload Web Application Plan

Status: approved for implementation.

## Goal

Provide a small authenticated React application that places gathered files in
the remote `inbox/` mirror of `data/inbox/`. It is a gathering boundary only:
the existing CLI remains the sole ingestion boundary and continues to move
Artefacts into `data/artefacts/` while appending Documents and Observations.

## Decisions

- The deployable is `apps/inbox/` (`@event-database/inbox`).
- React and Vite provide the browser application; CSS custom properties and
  `data-*` attributes own the theme.
- Cognito uses authorization code flow with PKCE. The application is private.
- A Cognito-authorized HTTP API invokes a Lambda that issues short-lived,
  conditional S3 `PUT` URLs.
- The browser uploads directly to the private data bucket at
  `inbox/<filename>`; it never receives credentials.
- Multiple files are accepted, original names are preserved, and collisions
  are rejected. The signed `If-None-Match: *` condition closes the race.
- Files are arbitrary types; the first limit is 20 files and 25 MiB per file.
- `catalogue inbox pull` performs explicit one-way S3-to-local inbox transfer.
  Full data-directory synchronization remains deferred.
- Native CloudFormation owns AWS infrastructure. The data bucket is private
  and is never a CloudFront origin.

## System

```text
Browser -> Cognito -> CloudFront static application
Browser -> API Gateway + Cognito JWT -> Lambda signer -> S3 inbox/<filename>
CLI catalogue inbox pull -> local data/inbox/<filename>
CLI catalogue ingest -> local data/artefacts + append-only JSONL
```

The data bucket retains version history, blocks public access, requires TLS,
and permits the signer only to put objects below `inbox/`. Retained Artefacts
remain private as required by ADR 0008.

## Browser Contract

`POST /upload-intents` accepts a JSON body containing names, sizes and optional
MIME types. It validates the batch, produces server-owned inbox keys, and
returns one five-minute presigned URL per file. The client sends its file with
the returned `Content-Type` and `If-None-Match: *` headers. A `412` is rendered
as a name collision. URLs and tokens are never logged or persisted.

The only authenticated surface is an accessible full-page native multi-file
input. Its label is also the desktop drop target. It starts uploads immediately,
limits concurrent uploads to three, reports progress and outcomes inline, and
works with the native mobile picker. It has no route, dashboard, or secondary
product feature.

## Filename Policy

Names are preserved but must be direct inbox filenames: non-empty, not `.`,
`..`, or hidden; without slash, backslash, NUL, or control characters; at most
255 UTF-8 bytes. Duplicate names in one selection are rejected before any
upload begins.

## Inbox Pull

The CLI pages direct `inbox/` objects, rejects malformed keys, streams each to
a temporary file, atomically installs it without overwrite, then deletes its
exact remote version. Equal-byte local collisions are treated as completed
previous transfers; different-byte collisions retain both copies and report a
failure. Temporary files are always removed. The command uses the normal AWS
credential provider chain plus `CATALOGUE_DATA_BUCKET` and `AWS_REGION`.

## Infrastructure

CloudFormation creates a versioned private data bucket, private website bucket,
CloudFront Origin Access Control, Cognito pool/domain/client, HTTP API JWT
authorizer, signer Lambda, least-privilege IAM role, CORS, logs, rate limits,
and outputs needed for browser configuration and the pull command. Deployment
packages the Lambda, deploys the stack, builds the SPA with public stack
outputs, syncs website assets, and invalidates CloudFront.

## Tests And Verification

Implement executable behavior test-first. Cover filename validation; intent
validation and signing; native input/drop/keyboard/progress/collision UI;
inbox pagination, atomic install, checksums, deletion retries and collisions;
desktop and mobile browser interaction; and CloudFormation validation.

Run formatting, linting, typechecking, unit tests, browser tests, builds,
template validation, and `catalogue verify`. A deployed smoke test must prove
unauthenticated API calls and public S3 access fail while authenticated picker,
drop, collision, pull, and existing ingest behavior succeed.
