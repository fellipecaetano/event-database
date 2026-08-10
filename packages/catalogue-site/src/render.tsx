import { renderToStaticMarkup } from "react-dom/server";

import type { Locale, SiteMessages } from "./locales.js";
import type { PublicEvent } from "./site-model.js";

export interface RenderOptions {
  readonly siteName: string;
  readonly asOf: string;
  readonly locale: Locale;
  readonly messages: SiteMessages;
  readonly baseUrl?: string;
}

export function renderListPage(
  title: string,
  events: readonly PublicEvent[],
  options: RenderOptions,
  currentPath: string,
  archiveYears: readonly string[],
): string {
  return document(
    title,
    options.messages.metadata.description,
    <>
      <SiteHeader currentPath={currentPath} options={options} />
      <main>
        <section className="hero">
          <p className="eyebrow">{options.messages.list.musicEvents}</p>
          <h1>{title}</h1>
          <p>
            {events.length === 0
              ? options.messages.list.noEvents
              : options.messages.list.intro}
          </p>
        </section>
        <Search messages={options.messages} />
        <section
          aria-live="polite"
          aria-label={options.messages.list.musicEvents}
        >
          <p data-no-results hidden className="empty">
            {options.messages.list.noResults}{" "}
            <button type="button" data-reset-search>
              {options.messages.list.clearSearch}
            </button>
          </p>
          <ol className="event-list">
            {events.map((event) => (
              <EventRow
                event={event}
                currentPath={currentPath}
                locale={options.locale}
                messages={options.messages}
                key={event.id}
              />
            ))}
          </ol>
        </section>
        {archiveYears.length > 0 ? (
          <nav
            className="archives"
            aria-label={options.messages.navigation.historyYears}
          >
            {archiveYears.map((year) => (
              <a
                href={relative(currentPath, `past/${year}/index.html`)}
                key={year}
              >
                {year}
              </a>
            ))}
          </nav>
        ) : null}
      </main>
      <Footer asOf={options.asOf} options={options} />
    </>,
    options,
    currentPath,
  );
}

export function renderEventPage(
  event: PublicEvent,
  options: RenderOptions,
): string {
  const path = `events/${event.id}/index.html`;
  const description = `${event.title} · ${event.venue}`;
  const jsonLd = jsonLdFor(event, options, path);
  return document(
    `${event.title} | ${options.siteName}`,
    description,
    <>
      <SiteHeader currentPath={path} options={options} />
      <main className="event-detail">
        <p className="eyebrow">{formatDate(event.date, options.locale)}</p>
        <h1>{event.title}</h1>
        {event.status !== undefined && event.status !== "scheduled" ? (
          <p className="status">
            {statusLabel(event.status, options.messages)}
          </p>
        ) : null}
        {event.happeningNow ? (
          <p className="status">{options.messages.event.happeningNow}</p>
        ) : null}
        <dl>
          <Detail label={options.messages.event.venue} value={event.venue} />
          <Detail
            label={options.messages.event.start}
            value={formatTime(event.start)}
          />
          <Detail
            label={options.messages.event.show}
            value={formatTime(event.showtime)}
          />
          <Detail
            label={options.messages.event.end}
            value={formatTime(event.end)}
          />
          <Detail
            label={options.messages.event.lineup}
            value={event.lineup.join(", ")}
          />
          <Detail
            label={options.messages.event.genres}
            value={event.genres.join(", ")}
          />
          <Detail
            label={options.messages.event.price}
            value={formatPrice(event)}
          />
        </dl>
        {event.period === "future" ? (
          <TicketAction event={event} messages={options.messages} />
        ) : null}
      </main>
      <Footer asOf={options.asOf} options={options} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </>,
    options,
    path,
  );
}

function SiteHeader({
  currentPath,
  options,
}: {
  readonly currentPath: string;
  readonly options: RenderOptions;
}): React.JSX.Element {
  return (
    <header className="masthead">
      <a href={relative(currentPath, "index.html")} className="wordmark">
        {options.siteName}
      </a>
      <nav aria-label={options.messages.navigation.history}>
        <a href={relative(currentPath, "index.html")}>
          {options.messages.navigation.upcoming}
        </a>
        <a href={relative(currentPath, "past/index.html")}>
          {options.messages.navigation.history}
        </a>
      </nav>
    </header>
  );
}

function EventRow({
  event,
  currentPath,
  locale,
  messages,
}: {
  readonly event: PublicEvent;
  readonly currentPath: string;
  readonly locale: Locale;
  readonly messages: SiteMessages;
}): React.JSX.Element {
  const search = normalize(
    [event.title, event.venue, ...event.lineup, ...event.genres].join(" "),
  );
  return (
    <li>
      <article data-event data-search={search}>
        <time dateTime={event.date}>{formatDate(event.date, locale)}</time>
        <div>
          <h2>
            <a href={relative(currentPath, `events/${event.id}/index.html`)}>
              {event.title}
            </a>
          </h2>
          {event.lineup.length > 0 ? <p>{event.lineup.join(" · ")}</p> : null}
          <p className="muted">{event.venue}</p>
        </div>
        <div className="event-meta">
          {eventTimes(event, messages.event.timeToConfirm).map((time) => (
            <span key={time}>{time}</span>
          ))}
          {formatPrice(event) === undefined ? null : (
            <span>{formatPrice(event)}</span>
          )}
          {event.status === undefined || event.status === "scheduled" ? null : (
            <span className="status">
              {statusLabel(event.status, messages)}
            </span>
          )}
        </div>
      </article>
    </li>
  );
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}): React.JSX.Element | null {
  return value === undefined || value === "" ? null : (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function TicketAction({
  event,
  messages,
}: {
  readonly event: PublicEvent;
  readonly messages: SiteMessages;
}): React.JSX.Element | null {
  if (event.status === "sold_out") return null;
  if (event.ticketUrl !== undefined)
    return (
      <p>
        <a
          className="ticket"
          href={event.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          {messages.tickets.buy}
        </a>
      </p>
    );
  if (event.ticketsAtDoor) return <p>{messages.tickets.atDoor}</p>;
  return event.ticketsExist ? <p>{messages.tickets.available}</p> : null;
}

function Search({
  messages,
}: {
  readonly messages: SiteMessages;
}): React.JSX.Element {
  return (
    <form className="search" role="search">
      <label htmlFor="event-search">{messages.list.searchLabel}</label>
      <input
        id="event-search"
        name="q"
        type="search"
        autoComplete="off"
        data-search-input
      />
      <button type="button" data-reset-search>
        {messages.list.clearSearch}
      </button>
    </form>
  );
}

function Footer({
  asOf,
  options,
}: {
  readonly asOf: string;
  readonly options: RenderOptions;
}): React.JSX.Element {
  const formatted = new Intl.DateTimeFormat(options.locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(asOf));
  return <footer>{options.messages.footer.updatedAt(formatted)}</footer>;
}

function document(
  title: string,
  description: string,
  body: React.ReactNode,
  options: RenderOptions,
  currentPath: string,
): string {
  const canonical =
    options.baseUrl === undefined
      ? undefined
      : new URL(currentPath, options.baseUrl).toString();
  return `<!doctype html>${renderToStaticMarkup(
    <html lang={options.locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        {canonical === undefined ? null : (
          <>
            <link rel="canonical" href={canonical} />
            <meta property="og:url" content={canonical} />
          </>
        )}
        <link
          rel="stylesheet"
          href={relative(currentPath, "assets/base.css")}
        />
        <link
          rel="stylesheet"
          href={relative(currentPath, "assets/theme.css")}
        />
        <script defer src={relative(currentPath, "assets/search.js")} />
      </head>
      <body>{body}</body>
    </html>,
  )}`;
}

function jsonLdFor(
  event: PublicEvent,
  options: RenderOptions,
  path: string,
): string {
  const startDate = event.start ?? event.showtime ?? event.date;
  const value = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    ...(options.baseUrl === undefined
      ? {}
      : {
          "@id": new URL(path, options.baseUrl).toString(),
          url: new URL(path, options.baseUrl).toString(),
        }),
    name: event.title,
    startDate,
    ...(event.end === undefined ? {} : { endDate: event.end }),
    location: { "@type": "Place", name: event.venue },
    ...(event.status === "cancelled"
      ? { eventStatus: "https://schema.org/EventCancelled" }
      : {}),
    ...(event.status === "postponed"
      ? { eventStatus: "https://schema.org/EventPostponed" }
      : {}),
    ...(event.ticketUrl === undefined && event.status !== "sold_out"
      ? {}
      : {
          offers: {
            "@type": "Offer",
            ...(event.ticketUrl === undefined ? {} : { url: event.ticketUrl }),
            ...(event.status === "sold_out"
              ? { availability: "https://schema.org/SoldOut" }
              : {}),
          },
        }),
  };
  return safeJson(value);
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function statusLabel(
  status: Exclude<PublicEvent["status"], undefined | "scheduled">,
  messages: SiteMessages,
): string {
  if (status === "cancelled") return messages.status.cancelled;
  if (status === "postponed") return messages.status.postponed;
  return messages.status.soldOut;
}

function relative(from: string, to: string): string {
  const up = from.split("/").length - 1;
  return `${"../".repeat(up)}${to}`;
}

function formatDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

const timeStart = 11;
const timeEnd = 16;
function formatTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.includes("T") ? value.slice(timeStart, timeEnd) : undefined;
}
function eventTimes(
  event: PublicEvent,
  placeholder: string,
): readonly string[] {
  const times = [formatTime(event.start), formatTime(event.showtime)].filter(
    (time): time is string => time !== undefined,
  );
  return times.length === 0 ? [placeholder] : times;
}

function formatPrice(event: PublicEvent): string | undefined {
  if (event.price === undefined) return undefined;
  if (event.currency === undefined || !/^[A-Z]{3}$/u.test(event.currency)) {
    return String(event.price);
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: event.currency,
  }).format(event.price);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}
