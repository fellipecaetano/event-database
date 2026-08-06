import { describe, expect, it } from "vitest";

import { localeMessages, messagesFor } from "./locales.js";

describe("locale messages", () => {
  it("provides a complete Brazilian Portuguese dictionary", () => {
    expect(Object.keys(localeMessages)).toEqual(["pt-BR"]);
    expect(messagesFor("pt-BR").tickets.buy).toBe("Comprar ingressos");
  });
});
