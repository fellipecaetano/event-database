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
  it("renders escaped static pages and omits unsafe ticket URLs", () => {
    const site = generateCatalogueSite(catalogue, {
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

  it("keeps the search clear button readable against the theme", () => {
    const site = generateCatalogueSite(catalogue, {
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

  it("produces stable opaque event paths", () => {
    const first = generateCatalogueSite(catalogue, {
      siteName: "Agenda",
      locale: "pt-BR",
    });
    const second = generateCatalogueSite(catalogue, {
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
});
