import { describe, expect, it } from "vitest";

import { messagesFor } from "./locales.js";
import { renderEventPage, renderListPage } from "./render.js";
import type { PublicEvent } from "./site-model.js";

const options = {
  siteName: "Agenda",
  asOf: "2026-08-05T12:00:00Z",
  locale: "pt-BR" as const,
  messages: messagesFor("pt-BR"),
};
const event: PublicEvent = {
  id: "evt_1234567890123456789012",
  title: "Evento",
  date: "2026-08-07",
  venue: "Casa",
  lineup: [],
  genres: [],
  ticketUrl: "https://tickets.example/show",
  status: "sold_out",
  period: "future",
  happeningNow: false,
};

describe("static renderers", () => {
  it("renders social metadata and keeps sold-out purchase actions hidden", () => {
    const html = renderEventPage(event, options);

    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).not.toContain("Comprar ingressos");
  });

  it("publishes sold-out structured availability without a ticket URL", () => {
    const { ticketUrl: _ticketUrl, ...soldOutWithoutUrl } = event;
    const html = renderEventPage(soldOutWithoutUrl, options);

    expect(html).toContain("https://schema.org/SoldOut");
  });

  it("shows both Start and Showtime in a list row", () => {
    const html = renderListPage(
      "Próximos eventos",
      [
        {
          ...event,
          status: "scheduled",
          start: "2026-08-07T18:00:00-03:00",
          showtime: "2026-08-07T20:00:00-03:00",
        },
      ],
      options,
      "index.html",
      [],
    );

    expect(html).toContain("18:00");
    expect(html).toContain("20:00");
  });

  it("renders complete list HTML without relying on browser JavaScript", () => {
    const html = renderListPage(
      "Próximos eventos",
      [event],
      options,
      "index.html",
      [],
    );

    expect(html).toContain("Evento");
    expect(html).toContain("data-search-input");
    expect(html).toContain('src="assets/search.js"');
  });
});
