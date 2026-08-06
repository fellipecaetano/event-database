import { describe, expect, it } from "vitest";

import { localeMessages, messagesFor } from "./locales.js";

describe("locale messages", () => {
  it("provides a complete Brazilian Portuguese dictionary", () => {
    expect(Object.keys(localeMessages)).toEqual(["pt-BR"]);
    expect(messagesFor("pt-BR").list.musicEvents).toBe("Eventos musicais");
    expect(messagesFor("pt-BR").metadata.description).toBe(
      "Agenda de eventos musicais.",
    );
  });
});
