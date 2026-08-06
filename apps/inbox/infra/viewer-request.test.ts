import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

interface Request {
  uri: string;
  headers: Record<string, { value: string }>;
  querystring: Record<
    string,
    { value: string; multiValue?: { value: string }[] }
  >;
}

const loadHandler = async (): Promise<
  (event: { request: Request }) => unknown
> => {
  const source = await readFile(
    new URL("./viewer-request.cff", import.meta.url),
    "utf8",
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context["handler"] as (event: { request: Request }) => unknown;
};

const request = (uri: string, host = "musicaemsp.com.br"): Request => ({
  uri,
  headers: { host: { value: host } },
  querystring: {},
});

describe("catalogue viewer request", () => {
  it("redirects www to apex while preserving the URI and query", async () => {
    const handler = await loadHandler();
    const input = request("/events/abc", "www.musicaemsp.com.br");
    input.querystring = {
      tag: { value: "samba" },
      artist: {
        value: "A B",
        multiValue: [{ value: "A B" }, { value: "C&D" }],
      },
    };

    expect(handler({ request: input })).toEqual({
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: {
          value:
            "https://musicaemsp.com.br/events/abc?tag=samba&artist=A%20B&artist=C%26D",
        },
      },
    });
  });

  it("redirects the inbox shell and known extensionless catalogue routes to slashes", async () => {
    const handler = await loadHandler();

    for (const uri of ["/inbox", "/past", "/past/2025", "/events/abc-123"]) {
      expect(handler({ request: request(uri) })).toMatchObject({
        statusCode: 301,
        headers: { location: { value: `${uri}/` } },
      });
    }
  });

  it("rewrites root and slash routes to literal index keys", async () => {
    const handler = await loadHandler();

    expect(handler({ request: request("/") })).toMatchObject({
      uri: "/index.html",
    });
    expect(handler({ request: request("/past/") })).toMatchObject({
      uri: "/past/index.html",
    });
    expect(handler({ request: request("/inbox/") })).toMatchObject({
      uri: "/inbox/index.html",
    });
  });

  it("leaves files and unknown paths unchanged", async () => {
    const handler = await loadHandler();

    for (const uri of ["/base.css", "/inbox/assets/app.js", "/not-a-route"]) {
      const input = request(uri);
      expect(handler({ request: input })).toBe(input);
    }
  });
});
