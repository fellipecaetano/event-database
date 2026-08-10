import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { Catalogue } from "@event-database/core";

import { generateCatalogueSite } from "./generate.js";

const catalogue: Catalogue = {
  asOf: "2026-08-05T12:00:00Z",
  events: [
    {
      id: "019fa69b-63ea-778e-8595-cd28e40852d1",
      observationIds: [],
      staleValidationIds: [],
      facts: {
        existence: {
          state: "known",
          value: true,
          confidence: "single-source",
          evidence: [],
        },
        title: {
          state: "known",
          value: "João </script><script>bad()</script>",
          confidence: "single-source",
          evidence: [],
        },
        date: {
          state: "known",
          value: "2026-08-07",
          confidence: "single-source",
          evidence: [],
        },
        venue_name: {
          state: "known",
          value: "Casa",
          confidence: "single-source",
          evidence: [],
        },
        ticket_url: {
          state: "known",
          value: "javascript:alert(1)",
          confidence: "single-source",
          evidence: [],
        },
      },
    },
  ],
  venues: [],
};

describe("generateCatalogueSite", () => {
  it("renders escaped static pages and omits unsafe ticket URLs", async () => {
    const site = await generateCatalogueSite(catalogue, {
      siteName: "Agenda",
      locale: "pt-BR",
    });
    const detail = site.files.find((file) => file.path.startsWith("events/"));

    expect(detail?.contents).toContain("João &lt;/script&gt;");
    expect(detail?.contents).not.toContain('href="javascript:');
    expect(site.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsafe-ticket-url" }),
    );
    expect(site.files.map((file) => file.path)).toContain("index.html");
  });

  it("keeps the search clear button readable against the theme", async () => {
    const site = await generateCatalogueSite(catalogue, {
      siteName: "Agenda",
      locale: "pt-BR",
    });
    const stylesheet = site.files.find(
      (file) => file.path === "assets/base.css",
    );

    expect(stylesheet?.contents).toContain(
      ".search button,.ticket{font:inherit;padding:.5rem .75rem;border:1px solid var(--color-border);color:var(--color-text);background:var(--color-background)}",
    );
  });

  it("minifies generated CSS and JavaScript assets", async () => {
    const site = await generateCatalogueSite(catalogue, {
      siteName: "Agenda",
      locale: "pt-BR",
    });
    const stylesheet = site.files.find(
      (file) => file.path === "assets/base.css",
    );
    const script = site.files.find((file) => file.path === "assets/search.js");
    const [sourceStylesheet, sourceScript] = await Promise.all([
      readFile(new URL("../assets/base.css", import.meta.url), "utf8"),
      readFile(new URL("../assets/search.js", import.meta.url), "utf8"),
    ]);

    expect(sourceStylesheet).toContain("* {\n  box-sizing: border-box;\n}");
    expect(sourceScript).toContain(
      'const searchInput = document.querySelector("[data-search-input]");',
    );
    expect(stylesheet?.contents).not.toBe(sourceStylesheet);
    expect(script?.contents).not.toBe(sourceScript);
    expect(stylesheet?.contents).toContain("*{box-sizing:border-box}");
    expect(script?.contents).toContain("(()=>{");
    expect(script?.contents).not.toContain("const searchInput =");
  });

  it("produces stable opaque event paths", async () => {
    const first = await generateCatalogueSite(catalogue, {
      siteName: "Agenda",
      locale: "pt-BR",
    });
    const second = await generateCatalogueSite(catalogue, {
      siteName: "Outro nome",
      locale: "pt-BR",
    });

    expect(
      first.files.find((file) => file.path.startsWith("events/"))?.path,
    ).toBe(second.files.find((file) => file.path.startsWith("events/"))?.path);
    expect(
      first.files.find((file) => file.path.startsWith("events/"))?.path,
    ).not.toContain(catalogue.events[0]?.id ?? "");
  });

  it("fails when two Events produce the same public ID", async () => {
    const firstEvent = catalogue.events[0];
    if (firstEvent === undefined)
      throw new Error("test catalogue has no Event");
    await expect(
      generateCatalogueSite(
        {
          ...catalogue,
          events: [firstEvent, { ...firstEvent }],
        },
        { siteName: "Agenda", locale: "pt-BR" },
      ),
    ).rejects.toThrow("public Event ID collision");
  });
});
