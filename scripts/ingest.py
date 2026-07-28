"""Helpers for turning a gathered Document into log records.

Import from an extraction script; see skills/extract-document/SKILL.md.
"""

import hashlib
import json
import os
import secrets
import shutil
import time

INBOX = "data/inbox"
DOCUMENTS = "data/documents"
ARTEFACTS = "data/artefacts"

_last_ms = 0
_counter = 0


def uuid7() -> str:
    """RFC 9562 v7, monotonic within a millisecond via the rand_a counter.

    Without the counter, ids minted in one run sort randomly, which discards
    the only reason to prefer a time-ordered id.
    """
    global _last_ms, _counter
    ms = int(time.time() * 1000)
    if ms == _last_ms:
        _counter += 1
    else:
        _last_ms, _counter = ms, secrets.randbits(11)
    b = bytearray(os.urandom(16))
    for i in range(6):
        b[i] = (ms >> (40 - 8 * i)) & 0xFF
    b[6] = 0x70 | ((_counter >> 8) & 0x0F)
    b[7] = _counter & 0xFF
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_hash(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def _documents():
    if not os.path.isdir(DOCUMENTS):
        return
    for name in sorted(os.listdir(DOCUMENTS)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(DOCUMENTS, name), encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    yield json.loads(line)


def ingested_hash(path: str) -> str | None:
    """Return the id of the Document made from this exact file, if any.

    Hashes the bytes rather than the extracted text. Two agents reading one
    HTML file will keep different text — one drops the comments, another the
    footer — so a text hash cannot answer whether a file has been processed.
    """
    h = file_hash(path)
    for d in _documents():
        if d.get("artefact_hash") == h:
            return d["id"]
    return None


def pending(inbox: str = INBOX) -> list[str]:
    """Files awaiting ingestion: present in the inbox and not yet in the log."""
    if not os.path.isdir(inbox):
        return []
    paths = [
        os.path.join(inbox, n)
        for n in sorted(os.listdir(inbox))
        if not n.startswith(".") and os.path.isfile(os.path.join(inbox, n))
    ]
    return [p for p in paths if ingested_hash(p) is None]


def verify_spans(observations: list[dict], text: str) -> None:
    """Raise unless every span occurs verbatim in the Document's text (ADR 0007)."""
    failures = [
        f"{o['subject']['kind']}.{field}: {span[:60]!r}"
        for o in observations
        for bucket in ("claims", "extras")
        for field, claim in o.get(bucket, {}).items()
        for span in claim.get("spans", [])
        if span not in text
    ]
    if failures:
        raise SystemExit(
            f"{len(failures)} ungrounded span(s):\n  " + "\n  ".join(failures[:10])
        )


def retain(source_path: str) -> tuple[str, str]:
    """Move an inbox file to where artefacts are kept. Returns (path, hash)."""
    os.makedirs(ARTEFACTS, exist_ok=True)
    destination = os.path.join(ARTEFACTS, os.path.basename(source_path))
    shutil.move(source_path, destination)
    return destination, file_hash(destination)


def append(path: str, records: list[dict]) -> None:
    """Append records, refusing a Document whose input file is already ingested.

    This is the only layer that survives an agent skipping the documentation.
    """
    for r in records:
        if r.get("type") != "document":
            continue
        h = r.get("artefact_hash")
        if not h:
            raise SystemExit(f"document {r['id']} has no artefact_hash")
        for existing in _documents():
            if existing.get("artefact_hash") == h:
                raise SystemExit(
                    f"refusing to append: that file is already Document {existing['id']}"
                )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
