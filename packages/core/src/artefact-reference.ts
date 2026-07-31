const retainedPrefix = "data/artefacts/";

/** A portable reference to one retained source Artefact. */
export class ArtefactReference {
  private constructor(
    readonly value: string,
    readonly objectKey: string,
  ) {}

  static parse(value: string): ArtefactReference {
    if (!value.startsWith(retainedPrefix)) {
      throw new Error(
        `invalid Artefact reference: expected ${retainedPrefix}<filename>`,
      );
    }
    return ArtefactReference.retained(value.slice(retainedPrefix.length));
  }

  static retained(filename: string): ArtefactReference {
    if (
      filename.length === 0 ||
      filename === "." ||
      filename === ".." ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\u0000")
    ) {
      throw new Error(`invalid retained Artefact filename: ${filename}`);
    }
    return new ArtefactReference(
      `${retainedPrefix}${filename}`,
      `artefacts/${filename}`,
    );
  }

  toString(): string {
    return this.value;
  }
}
