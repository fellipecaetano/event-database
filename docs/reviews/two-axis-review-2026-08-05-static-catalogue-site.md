# Two-axis review - 5 August 2026

Scope: `HEAD~1...HEAD`, containing `8cb070b Add static catalogue site generator`.
The approved implementation plan is
[`2026-08-05-static-catalogue-site.md`](../plans/2026-08-05-static-catalogue-site.md).

## Standards

### Documented-standard breaches

1. `packages/catalogue-site/src/site-model.ts:46` and
   `packages/catalogue-site/src/render.tsx:18,85` - New executable modules have no direct
   tests. `AGENTS.md` requires every new executable source file to have direct tests; the
   generator tests cover them only indirectly.

2. `apps/cli/src/static-site-output.ts:24-38` - `readTheme` has no behavioral or
   failure-path coverage. `AGENTS.md` requires tests for behavior and failure modes.

3. `packages/catalogue-site/src/generate.ts:7-12,32-37` - `locale` is typed as an arbitrary
   `string` while the implementation accepts only `"pt-BR"`. `AGENTS.md` requires constraints
   to be modeled in types where possible.

### Judgement calls

1. `packages/catalogue-site/src/render.tsx:28-35,94-101` - Possible duplicated code: the
   masthead and navigation JSX are repeated in list and Event page rendering.

2. `packages/catalogue-site/src/render.tsx:363-365` - Possible mysterious names: the
   embedded search script uses opaque identifiers such as `q`, `n`, and `v`, making the
   behavior harder to maintain or test independently.

## Spec

### Missing or partial requirements

1. Public-ID destination collisions do not fail generation. The plan requires collision
   detection at `docs/plans/2026-08-05-static-catalogue-site.md:236`.

2. There is no typed locale dictionary; Portuguese copy is embedded in `render.tsx`. The plan
   requires `locales.ts` and dictionary-complete translations at lines 389-394.

3. Open Graph and basic social metadata are missing, despite the requirement at lines 495-504.

4. Official WOFF2 fonts and OFL licences are absent, contrary to line 590.

5. CLI success output omits the build instant, locale, and warning counts required at
   lines 725-733.

### Scope creep

1. `build-site` accepts undocumented `--repository`; the specified interface provides only
   positional `[repository]` at lines 29-36.

2. The generator writes `past/<current-year>/index.html` in addition to `past/index.html`.
   The plan specifies archive pages for prior represented years only at line 447.

### Incorrect implementation

1. A sold-out future Event with a ticket URL renders `Comprar ingressos`. Sold-out status must
   remain dominant even where a URL exists (line 459).

2. Offset-free Start and End values are treated as non-timed, preventing current/future/past
   classification and End-before-Start validation from following the plan. Offset-free values
   must be interpreted as Sao Paulo local values (line 315); known End drives classification
   (lines 320-325), and End before Start is fatal (line 333).

## Summary

Standards: 5 findings; the most important is missing direct coverage for executable modules.
Spec: 9 findings; the most important is incorrect offset-free datetime handling.
