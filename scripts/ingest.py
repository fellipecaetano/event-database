"""Helpers for turning a gathered Document into log records.

Import from an extraction script; see .claude/skills/extract-document/SKILL.md.
"""

import hashlib
import json
import os
import secrets
import time

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


def already_ingested(text: str, path: str = "log/documents") -> str | None:
    """Return the id of an existing Document holding this text, if any."""
    h = text_hash(text)
    for name in sorted(os.listdir(path)) if os.path.isdir(path) else []:
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(path, name), encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    d = json.loads(line)
                    if d.get("text_hash") == h:
                        return d["id"]
    return None


def append(path: str, records: list[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
