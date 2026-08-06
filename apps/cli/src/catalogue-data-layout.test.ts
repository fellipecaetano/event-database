import { describe, expect, it } from "vitest";

import { logRecordSchema } from "@event-database/core";

import { CatalogueDataLayout } from "./catalogue-data-layout.js";

const document = logRecordSchema.parse({
  type: "document",
  id: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  at: "2026-07-27T22:55:00Z",
  v: 1,
  source: "source",
  retrieved_at: "2026-07-27T22:55:00Z",
  text_source: "retrieved",
  artefact: "data/artefacts/post.txt",
  artefact_hash: "a".repeat(64),
  text_hash: "b".repeat(64),
  text: "Evento",
});

describe("CatalogueDataLayout", () => {
  it("maps record kinds to their monthly log partitions", () => {
    const layout = new CatalogueDataLayout("/repository");

    expect(layout.streamFor(document)).toBe("documents");
    expect(layout.logFileFor(document)).toBe(
      "/repository/data/documents/2026-07.jsonl",
    );
    expect(
      layout.logFileFor(
        logRecordSchema.parse({
          type: "observation",
          id: "019fa69b-63ea-778b-953f-6f7a5bb62657",
          at: document.at,
          v: 1,
          document: document.id,
          extractor: "extractor@1",
          subject: {
            kind: "event",
            id: "019fa69b-63ea-778c-964c-a63e474676a5",
          },
          claims: {},
          extras: {},
        }),
      ),
    ).toBe("/repository/data/observations/2026-07.jsonl");
  });

  it("maps Judgements to the Judgements stream", () => {
    const layout = new CatalogueDataLayout("/repository");

    expect(
      layout.logFileFor(
        logRecordSchema.parse({
          type: "redirect",
          id: "019fa69b-63ea-778b-953f-6f7a5bb62657",
          at: document.at,
          v: 1,
          from: "event:019fa69b-63ea-778c-964c-a63e474676a5",
          to: "event:019fa69b-63ea-778d-964c-a63e474676a5",
          reason: "merged",
        }),
      ),
    ).toBe("/repository/data/judgements/2026-07.jsonl");
  });

  it("resolves retained Artefacts below the data directory", () => {
    const layout = new CatalogueDataLayout("/repository");

    const location = layout.retainedArtefact("Ao vivo.tsv");

    expect(location.reference.value).toBe("data/artefacts/Ao vivo.tsv");
    expect(location.reference.objectKey).toBe("artefacts/Ao vivo.tsv");
    expect(location.path).toBe("/repository/data/artefacts/Ao vivo.tsv");
  });

  it("accepts a direct inbox file and rejects paths outside it", () => {
    const layout = new CatalogueDataLayout("/repository");

    expect(layout.assertInboxFile("/repository/data/inbox/post.html")).toEqual({
      path: "/repository/data/inbox/post.html",
      filename: "post.html",
      repositoryRelativePath: "data/inbox/post.html",
    });
    expect(() =>
      layout.assertInboxFile("/repository/data/artefacts/post.html"),
    ).toThrow(/inside/u);
    expect(() =>
      layout.assertInboxFile("/repository/data/inbox/nested/post.html"),
    ).toThrow(/directly/u);
  });
});
