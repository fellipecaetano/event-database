#!/usr/bin/env python3
"""List capitalised terms used across the docs that CONTEXT.md never defines.

    scripts/check-glossary.py

A sweep, not a gate: it reports candidates for a person to judge. Words are
counted only where they appear mid-sentence, since a capital at the start of a
sentence says nothing about whether a word is a domain term.

Known limitation: it only sees terms written Capitalised. Fold, Artefact and
Judgement were all missing from the glossary for weeks and none would have been
caught, because the prose writes them lower case and `artefact` appears mostly
as a backticked field name. Closing that gap needs a convention that domain
terms are capitalised in prose, which the docs do not currently follow.
"""

import os
import re
import sys
from collections import Counter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
GLOSSARY = os.path.join(ROOT, "CONTEXT.md")

# Proper nouns, formats and places: capitalised, but not ours to define.
NOT_OURS = {
    "Brazil", "Brazilian", "Paulo", "Rio", "Manaus", "Bela", "Vista", "Barra", "Funda",
    "Vila", "Madalena", "Mooca", "Perdizes", "Instagram", "Google", "Maps", "Sympla",
    "Eventbrite", "Resident", "Advisor", "FasTix", "Substack", "Renan", "Dissenha",
    "Fagundes", "Joia", "Cine", "Mundo", "Pensante", "Fabrique", "Club", "Warrior",
    "Queen", "Russo", "Passapusso", "Sobra", "Cerne", "Test", "Vivo", "Punk",
    "TypeScript", "Python", "Node", "Excel", "SQLite", "Postgres", "MCP", "LLM",
    "Claude", "Opus", "Crockford", "Lollapalooza", "Interlagos", "Trackers", "Audio",
    "Fabricio", "Trio", "Agathocles", "Alto", "Rey", "Sky", "Capim", "Artista", "Limão",
}


COMMON = {
    "The", "This", "That", "These", "Those", "Their", "They", "There", "Then", "Than",
    "And", "But", "For", "Not", "Nor", "Any", "All", "Both", "Each", "Every", "Some",
    "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Where", "When", "What", "Which", "Who", "Why", "How", "Anything", "Everything",
    "Nothing", "Nowhere", "Whatever", "Without", "Within", "From", "Into", "Onto",
    "Its", "Our", "Your", "His", "Her", "Only", "Also", "Once", "Never", "Always",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "English", "American", "Anglo", "Portuguese",
}

# Named inside another entry rather than defined on their own: the Confidence tiers.
DEFINED_INLINE = {"Validated", "Corroborated", "Single", "Contested"}


def glossary_terms(path: str) -> set[str]:
    terms = set()
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\*\*([A-Za-z][A-Za-z -]*)\*\*:", line)
        if m:
            term = m.group(1).strip()
            for word in [term] + term.split() + term.split("-"):
                terms.update({word, word + "s", word + "es", word.rstrip("h") + "hes"})
    return terms


def documents() -> list[str]:
    paths = [os.path.join(ROOT, "AGENTS.md")]
    for directory in ("docs", "docs/adr", "skills/extract-document"):
        full = os.path.join(ROOT, directory)
        if os.path.isdir(full):
            paths += [
                os.path.join(full, n) for n in sorted(os.listdir(full)) if n.endswith(".md")
            ]
    return [p for p in paths if os.path.isfile(p)]


def main() -> int:
    defined = glossary_terms(GLOSSARY)
    counts: Counter = Counter()
    where: dict[str, set[str]] = {}

    for path in documents():
        text = open(path, encoding="utf-8").read()
        text = re.sub(r"```.*?```", "", text, flags=re.S)      # code blocks
        text = re.sub(r"`[^`]*`", "", text)                    # inline code
        text = re.sub(r"\[[^\]]*\]\([^)]*\)", "", text)        # link targets
        text = "\n".join(l for l in text.split("\n") if l.count("|") < 2)  # table rows
        text = re.sub(r"[*_>|]|^\s*[-#]+\s*|\s*\[[ x]\]\s*", " ", text, flags=re.M)
        for sentence in re.split(r"(?<=[.:!?])\s+|\n", text):
            for word in re.findall(r"(?<![`\w])([A-Z][a-z]{2,})(?![A-Za-zÀ-ÿ])", sentence)[1:]:
                if word in defined or word in NOT_OURS or word in COMMON or word in DEFINED_INLINE:
                    continue
                counts[word] += 1
                where.setdefault(word, set()).add(os.path.relpath(path, ROOT))

    if not counts:
        print("Every capitalised term used in the docs is defined in CONTEXT.md.")
        return 0

    print(f"{len(counts)} capitalised terms not defined in CONTEXT.md:\n")
    for word, n in counts.most_common():
        files = ", ".join(sorted(where[word])[:3])
        print(f"  {n:4}  {word:18} {files}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
