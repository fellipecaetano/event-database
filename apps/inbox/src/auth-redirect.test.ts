import { describe, expect, it } from "vitest";

import { buildAuthenticationRedirectUrl } from "./auth-redirect.js";

describe("authentication redirect URL", () => {
  it("mounts production authentication beneath the inbox path", () => {
    expect(
      buildAuthenticationRedirectUrl(
        "https://musicaemsp.com.br/catalogue",
        "/inbox/",
      ),
    ).toBe("https://musicaemsp.com.br/inbox/");
  });

  it("keeps root-mounted local development at its origin", () => {
    expect(
      buildAuthenticationRedirectUrl("http://localhost:5173/page", "/"),
    ).toBe("http://localhost:5173/");
  });
});
