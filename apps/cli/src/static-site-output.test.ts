import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installStaticSite } from "./static-site-output.js";

const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("installStaticSite", () => {
  it("refuses to replace an unowned output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-database-site-"));
    paths.push(root);
    const output = join(root, "site");
    await writeFile(output, "not a directory");

    await expect(
      installStaticSite(output, root, [
        { path: "index.html", contents: "new" },
      ]),
    ).rejects.toThrow("real directory");
  });

  it("installs generated files and replaces its own output", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-database-site-"));
    paths.push(root);
    const output = join(root, "site");

    await installStaticSite(output, root, [
      { path: "index.html", contents: "first" },
    ]);
    await installStaticSite(output, root, [
      { path: "index.html", contents: "second" },
    ]);

    await expect(readFile(join(output, "index.html"), "utf8")).resolves.toBe(
      "second",
    );
  });

  it("refuses symlinked outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-database-site-"));
    paths.push(root);
    const target = join(root, "target");
    const output = join(root, "site");
    await writeFile(target, "sentinel");
    await symlink(target, output);

    await expect(
      installStaticSite(output, root, [
        { path: "index.html", contents: "new" },
      ]),
    ).rejects.toThrow("real directory");
    await expect(readFile(target, "utf8")).resolves.toBe("sentinel");
  });
});
