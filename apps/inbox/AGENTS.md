# Inbox uploader

- Keep the authenticated surface to multi-file upload and inline status.
- Upload only to private `inbox/<filename>` objects; never ingest or expose Artefacts.
- Preserve filenames and reject collisions, unsafe paths, hidden names, and silent overwrites.
- Prefer native browser controls, events, and CSS variables over UI dependencies.
- Keep themes in `data-*` attributes and CSS custom properties.
- Test input, drop, keyboard, mobile layout, failures, and S3 collision behavior.
- Keep tokens and presigned URLs out of logs and persistent storage.
