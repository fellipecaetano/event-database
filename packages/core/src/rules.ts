import type { FoldRules } from "./fold.js";
import { sourceTrustProfiles } from "./source-trust.js";

export function createProductionFoldRules(): FoldRules {
  return {
    version: "working-tree",
    extractorTrust: {
      "claude-opus-5/manual@draft": 1,
      "tsv-parser@1": 2,
    },
    sourceTrust: sourceTrustProfiles,
    sourceTrustOverrides: {},
  };
}

export function knownExtractorsFor(rules: FoldRules): Set<string> {
  return new Set(Object.keys(rules.extractorTrust));
}
