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
          <p className="eyebrow">{options.messages.list.liveMusic}</p>
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
          aria-label={options.messages.list.liveMusic}
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

export const baseCss = `*{box-sizing:border-box}body{margin:0;background:var(--color-background);color:var(--color-text);font-family:var(--font-body);line-height:1.5}.masthead,main,footer{max-width:72rem;margin:auto;padding:1.25rem}.masthead{display:flex;justify-content:space-between;gap:1rem}.masthead nav{display:flex;gap:1rem}.wordmark,h1,h2{font-family:var(--font-display)}a{color:inherit}.hero{padding:3rem 0}.eyebrow,.muted{color:var(--color-muted)}.event-list{list-style:none;padding:0}.event-list article{display:grid;grid-template-columns:10rem 1fr auto;gap:1rem;padding:1.25rem 0;border-top:1px solid var(--color-border)}.event-list h2{margin:0}.event-list p{margin:.25rem 0}.event-meta{display:grid;align-content:start;gap:.25rem;text-align:right}.status{color:var(--color-accent);font-weight:700}.search{display:flex;gap:.5rem;align-items:end;margin:2rem 0}.search label{display:grid;gap:.25rem;font-weight:700}.search input{font:inherit;padding:.5rem}.search button,.ticket{font:inherit;padding:.5rem .75rem;border:1px solid var(--color-border);color:var(--color-text);background:var(--color-background)}.ticket{display:inline-block;background:var(--color-accent);color:var(--color-background);text-decoration:none}dl{display:grid;grid-template-columns:max-content 1fr;gap:.5rem 1rem}.archives{display:flex;gap:1rem;margin:2rem 0}footer{color:var(--color-muted);border-top:1px solid var(--color-border);margin-top:3rem}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--color-focus);outline-offset:3px}@media(max-width:40rem){.event-list article{grid-template-columns:1fr}.event-meta{text-align:left}.masthead{display:block}.masthead nav{margin-top:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}`;
export const defaultThemeCss = `@font-face{font-family:Newsreader;src:url("fonts/newsreader.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:Archivo;src:url("fonts/archivo.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}:root{--color-background:#f7f0e3;--color-text:#17130f;--color-muted:#655d53;--color-accent:#c64020;--color-border:#c9bba8;--color-focus:#005fcc;--font-display:Newsreader,Georgia,serif;--font-body:Archivo,system-ui,sans-serif}@media(prefers-color-scheme:dark){:root{--color-background:#17130f;--color-text:#f7f0e3;--color-muted:#c9bba8;--color-accent:#ff7350;--color-border:#655d53;--color-focus:#78b7ff}}`;
export const searchScript = `(()=>{const searchInput=document.querySelector('[data-search-input]'),searchRows=[...document.querySelectorAll('[data-event]')],emptyState=document.querySelector('[data-no-results]'),resetButtons=[...document.querySelectorAll('[data-reset-search]')];if(!searchInput)return;const normalizeSearchText=value=>value.normalize('NFD').replace(/\\p{M}/gu,'').toLocaleLowerCase('pt-BR');const applySearch=()=>{const normalizedQuery=normalizeSearchText(searchInput.value.slice(0,200));let visibleCount=0;for(const row of searchRows){const isVisible=row.dataset.search?.includes(normalizedQuery)??true;row.hidden=!isVisible;if(isVisible)visibleCount++}if(emptyState)emptyState.hidden=visibleCount!==0;const currentUrl=new URL(location.href);normalizedQuery?currentUrl.searchParams.set('q',searchInput.value):currentUrl.searchParams.delete('q');history.replaceState(null,'',currentUrl)};searchInput.value=new URL(location.href).searchParams.get('q')??'';searchInput.addEventListener('input',applySearch);for(const resetButton of resetButtons)resetButton.addEventListener('click',()=>{searchInput.value='';applySearch();searchInput.focus()});applySearch()})();`;
