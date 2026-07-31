import { describe, expect, it } from "vitest";

import { ArtefactReference } from "./artefact-reference.js";

describe("ArtefactReference", () => {
  it("parses a retained Artefact and exposes its remote object key", () => {
    const reference = ArtefactReference.parse(
      "data/artefacts/Ao vivo_ shows.tsv",
    );

    expect(reference.value).toBe("data/artefacts/Ao vivo_ shows.tsv");
    expect(reference.objectKey).toBe("artefacts/Ao vivo_ shows.tsv");
    expect(reference.toString()).toBe(reference.value);
  });

  it("constructs retained references for arbitrary filenames", () => {
    expect(ArtefactReference.retained("unnamed.png")).toMatchObject({
      value: "data/artefacts/unnamed.png",
      objectKey: "artefacts/unnamed.png",
    });
  });

  it.each([
    "artefacts/post.txt",
    "data/artefacts/",
    "data/artefacts/../secret.txt",
    "data/artefacts/subdir/post.txt",
    "data/artefacts\\post.txt",
    "data/artefacts/post\u0000.txt",
  ])("rejects unsafe reference %j", (value) => {
    expect(() => ArtefactReference.parse(value)).toThrow(/invalid/u);
  });
});
