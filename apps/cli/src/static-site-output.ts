import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { GeneratedSiteFile } from "@event-database/catalogue-site";

const markerName = ".event-database-site.json";
const marker = JSON.stringify({
  generator: "@event-database/catalogue-site",
  version: 1,
});
const maximumThemeBytes = Number("1048576");

export async function readTheme(path: string, output: string): Promise<string> {
  if (isWithin(resolve(output), resolve(path))) {
    throw new Error("theme file must not be inside the output directory");
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`theme must be a regular file: ${path}`);
  }
  if (info.size > maximumThemeBytes) {
    throw new Error(
      `theme exceeds ${String(maximumThemeBytes)} bytes: ${path}`,
    );
  }
  return readFile(path, "utf8");
}

export async function installStaticSite(
  output: string,
  repository: string,
  files: readonly GeneratedSiteFile[],
): Promise<void> {
  const destination = await canonicalDestination(output);
  assertSafeDestination(destination, await realpath(repository));
  await assertExistingDestinationIsOwned(destination);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".event-database-site-"));
  let backup: string | undefined;
  try {
    for (const file of files) {
      const target = safeOutputPath(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents, { flag: "wx" });
    }
    await writeFile(join(staging, markerName), marker, { flag: "wx" });
    try {
      await lstat(destination);
      backup = await mkdtemp(join(parent, ".event-database-backup-"));
      await rm(backup, { recursive: true });
      await rename(destination, backup);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (backup !== undefined) await rename(backup, destination);
      throw error;
    }
    if (backup !== undefined)
      await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function canonicalDestination(path: string): Promise<string> {
  const destination = resolve(path);
  let parent = dirname(destination);
  while (parent !== dirname(parent)) {
    try {
      await lstat(parent);
      return resolve(await realpath(parent), relative(parent, destination));
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      parent = dirname(parent);
    }
  }
  return resolve(await realpath(parent), relative(parent, destination));
}

function safeOutputPath(root: string, file: string): string {
  if (
    file === "" ||
    isAbsolute(file) ||
    file
      .split(/[\\/]/u)
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`invalid generated site path: ${file}`);
  }
  const destination = resolve(root, file);
  if (!isWithin(root, destination))
    throw new Error(`generated site path escapes output: ${file}`);
  return destination;
}

async function assertExistingDestinationIsOwned(
  destination: string,
): Promise<void> {
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(`output must be a real directory: ${destination}`);
    const entries = await readdir(destination);
    if (entries.length === 0) return;
    const markerPath = join(destination, markerName);
    const markerInfo = await lstat(markerPath);
    if (
      markerInfo.isSymbolicLink() ||
      !markerInfo.isFile() ||
      (await readFile(markerPath, "utf8")) !== marker
    ) {
      throw new Error(
        `refusing to replace output not owned by event-database: ${destination}`,
      );
    }
  } catch (error) {
    if (isMissingPath(error)) return;
    throw error;
  }
}

function assertSafeDestination(destination: string, repository: string): void {
  const protectedPaths = [
    resolve(sep),
    resolve(homedir()),
    resolve(process.cwd()),
    repository,
    join(repository, "data"),
  ];
  if (
    protectedPaths.some(
      (path) => path === destination || isWithin(destination, path),
    )
  ) {
    throw new Error(`unsafe static site output directory: ${destination}`);
  }
}

function isWithin(directory: string, path: string): boolean {
  const pathRelative = relative(directory, path);
  return (
    pathRelative === "" ||
    (!pathRelative.startsWith(`..${sep}`) &&
      pathRelative !== ".." &&
      !isAbsolute(pathRelative))
  );
}
function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
