import type { Catalogue } from "@event-database/core";

import { buildSiteModel } from "./site-model.js";
import {
  baseCss,
  defaultThemeCss,
  renderEventPage,
  renderListPage,
  searchScript,
} from "./render.js";

export interface CatalogueSiteOptions {
  readonly siteName: string;
  readonly locale: string;
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

export function generateCatalogueSite(
  catalogue: Catalogue,
  options: CatalogueSiteOptions,
): GeneratedCatalogueSite {
  if (options.locale !== "pt-BR")
    throw new Error(`unsupported site locale: ${options.locale}`);
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
  const renderOptions = {
    ...options,
    asOf: catalogue.asOf,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
  const files: GeneratedSiteFile[] = [
    { path: "assets/base.css", contents: baseCss },
    { path: "assets/theme.css", contents: options.themeCss ?? defaultThemeCss },
    { path: "assets/search.js", contents: searchScript },
    {
      path: "index.html",
      contents: renderListPage(
        "Próximos eventos",
        model.future,
        renderOptions,
        "index.html",
        years,
      ),
    },
    {
      path: "past/index.html",
      contents: renderListPage(
        "Eventos passados",
        model.pastByYear.get(currentYear) ?? [],
        renderOptions,
        "past/index.html",
        years,
      ),
    },
  ];
  for (const year of years)
    files.push({
      path: `past/${year}/index.html`,
      contents: renderListPage(
        `Eventos de ${year}`,
        model.pastByYear.get(year) ?? [],
        renderOptions,
        `past/${year}/index.html`,
        years,
      ),
    });
  for (const event of [
    ...model.future,
    ...[...model.pastByYear.values()].flat(),
  ])
    files.push({
      path: `events/${event.id}/index.html`,
      contents: renderEventPage(event, renderOptions),
    });
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
