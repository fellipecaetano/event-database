import { readFile } from "node:fs/promises";

import type { Catalogue } from "@event-database/core";
import { transform } from "esbuild";

import { messagesFor, type Locale } from "./locales.js";
import { buildSiteModel } from "./site-model.js";
import { renderEventPage, renderListPage } from "./render.js";

export interface CatalogueSiteOptions {
  readonly siteName: string;
  readonly locale: Locale;
  readonly baseUrl?: string;
  readonly themeCss?: string;
}
export interface GeneratedSiteFile {
  readonly path: string;
  readonly contents: string | Uint8Array;
}
export interface SiteDiagnostic {
  readonly code: string;
  readonly message: string;
}
export interface GeneratedCatalogueSite {
  readonly files: readonly GeneratedSiteFile[];
  readonly diagnostics: readonly SiteDiagnostic[];
  readonly summary: {
    readonly upcoming: number;
    readonly past: number;
    readonly excluded: number;
  };
}

export async function generateCatalogueSite(
  catalogue: Catalogue,
  options: CatalogueSiteOptions,
): Promise<GeneratedCatalogueSite> {
  if (options.siteName.trim() === "")
    throw new Error("site name must not be empty");
  const baseUrl =
    options.baseUrl === undefined
      ? undefined
      : normalizeBaseUrl(options.baseUrl);
  const model = buildSiteModel(catalogue);
  const years = [...model.pastByYear.keys()].toSorted().reverse();
  const currentYear = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(new Date(catalogue.asOf));
  const archiveYears = years.filter((year) => year !== currentYear);
  const renderOptions = {
    ...options,
    asOf: catalogue.asOf,
    messages: messagesFor(options.locale),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
  const [baseCssSource, defaultThemeCssSource, searchScriptSource] =
    await Promise.all([
      readFile(new URL("../assets/base.css", import.meta.url), "utf8"),
      readFile(new URL("../assets/theme.css", import.meta.url), "utf8"),
      readFile(new URL("../assets/search.js", import.meta.url), "utf8"),
    ]);
  const [baseCss, defaultThemeCss, searchScript] = await Promise.all([
    minify(baseCssSource, "css"),
    minify(defaultThemeCssSource, "css"),
    minify(searchScriptSource, "js"),
  ]);
  const themeCss =
    options.themeCss === undefined
      ? defaultThemeCss
      : await minify(options.themeCss, "css");
  const files: GeneratedSiteFile[] = [
    { path: "assets/base.css", contents: baseCss },
    { path: "assets/theme.css", contents: themeCss },
    { path: "assets/search.js", contents: searchScript },
    {
      path: "assets/fonts/archivo.woff2",
      contents: await readFile(
        new URL("../assets/fonts/archivo.woff2", import.meta.url),
      ),
    },
    {
      path: "assets/fonts/newsreader.woff2",
      contents: await readFile(
        new URL("../assets/fonts/newsreader.woff2", import.meta.url),
      ),
    },
    {
      path: "assets/licences/Archivo-OFL.txt",
      contents: await readFile(
        new URL("../assets/licences/Archivo-OFL.txt", import.meta.url),
        "utf8",
      ),
    },
    {
      path: "assets/licences/Newsreader-OFL.txt",
      contents: await readFile(
        new URL("../assets/licences/Newsreader-OFL.txt", import.meta.url),
        "utf8",
      ),
    },
    {
      path: "index.html",
      contents: renderListPage(
        renderOptions.messages.list.upcomingTitle,
        model.future,
        renderOptions,
        "index.html",
        archiveYears,
      ),
    },
    {
      path: "past/index.html",
      contents: renderListPage(
        renderOptions.messages.list.pastTitle,
        model.pastByYear.get(currentYear) ?? [],
        renderOptions,
        "past/index.html",
        archiveYears,
      ),
    },
  ];
  for (const year of archiveYears)
    files.push({
      path: `past/${year}/index.html`,
      contents: renderListPage(
        renderOptions.messages.list.yearTitle(year),
        model.pastByYear.get(year) ?? [],
        renderOptions,
        `past/${year}/index.html`,
        archiveYears,
      ),
    });
  const publicIds = new Set<string>();
  for (const event of [
    ...model.future,
    ...[...model.pastByYear.values()].flat(),
  ]) {
    if (publicIds.has(event.id))
      throw new Error(`public Event ID collision: ${event.id}`);
    publicIds.add(event.id);
    files.push({
      path: `events/${event.id}/index.html`,
      contents: renderEventPage(event, renderOptions),
    });
  }
  if (baseUrl !== undefined)
    files.push({
      path: "sitemap.xml",
      contents: sitemap(files, baseUrl),
    });
  return {
    files: files.toSorted((left, right) => left.path.localeCompare(right.path)),
    diagnostics: model.diagnostics,
    summary: {
      upcoming: model.future.length,
      past: [...model.pastByYear.values()].flat().length,
      excluded: model.excluded,
    },
  };
}

async function minify(source: string, loader: "css" | "js"): Promise<string> {
  const result = await transform(source, { loader, minify: true });
  return result.code;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`invalid site base URL: ${value}`);
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.toString();
}
function sitemap(files: readonly GeneratedSiteFile[], baseUrl: string): string {
  const urls = files
    .filter((file) => file.path.endsWith(".html"))
    .map((file) =>
      new URL(file.path.replace(/index\.html$/u, ""), baseUrl).toString(),
    )
    .map((url) => `<url><loc>${xml(url)}</loc></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
