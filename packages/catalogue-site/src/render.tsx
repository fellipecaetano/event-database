import { renderToStaticMarkup } from "react-dom/server";

import type { PublicEvent } from "./site-model.js";

export interface RenderOptions {
  readonly siteName: string;
  readonly asOf: string;
  readonly baseUrl?: string;
}

const statusLabels = {
  cancelled: "Cancelado",
  postponed: "Adiado",
  sold_out: "Esgotado",
  scheduled: "",
} as const;

export function renderListPage(
  title: string,
  events: readonly PublicEvent[],
  options: RenderOptions,
  currentPath: string,
  archiveYears: readonly string[],
): string {
  return document(
    title,
    <>
      <header className="masthead">
        <a href={relative(currentPath, "index.html")} className="wordmark">
          {options.siteName}
        </a>
        <nav aria-label="Navegação principal">
          <a href={relative(currentPath, "index.html")}>Próximos</a>
          <a href={relative(currentPath, "past/index.html")}>Histórico</a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <p className="eyebrow">Música ao vivo</p>
          <h1>{title}</h1>
          <p>
            {events.length === 0
              ? "Ainda não há eventos nesta seleção."
              : "Shows e festas para marcar na agenda."}
          </p>
        </section>
        <Search />
        <section aria-live="polite" aria-label="Eventos">
          <p data-no-results hidden className="empty">
            Nenhum evento encontrado.{" "}
            <button type="button" data-reset-search>
              Limpar busca
            </button>
          </p>
          <ol className="event-list">
            {events.map((event) => (
              <EventRow
                event={event}
                currentPath={currentPath}
                key={event.id}
              />
            ))}
          </ol>
        </section>
        {archiveYears.length > 0 ? (
          <nav className="archives" aria-label="Anos do histórico">
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
      <Footer asOf={options.asOf} />
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
  const jsonLd = jsonLdFor(event, options, path);
  return document(
    `${event.title} | ${options.siteName}`,
    <>
      <header className="masthead">
        <a href={relative(path, "index.html")} className="wordmark">
          {options.siteName}
        </a>
        <nav aria-label="Navegação principal">
          <a href={relative(path, "index.html")}>Próximos</a>
          <a href={relative(path, "past/index.html")}>Histórico</a>
        </nav>
      </header>
      <main className="event-detail">
        <p className="eyebrow">{formatDate(event.date)}</p>
        <h1>{event.title}</h1>
        {event.status !== undefined && event.status !== "scheduled" ? (
          <p className="status">{statusLabels[event.status]}</p>
        ) : null}
        {event.happeningNow ? (
          <p className="status">Acontecendo agora</p>
        ) : null}
        <dl>
          <Detail label="Local" value={event.venue} />
          <Detail label="Início" value={formatTime(event.start)} />
          <Detail label="Show" value={formatTime(event.showtime)} />
          <Detail label="Fim" value={formatTime(event.end)} />
          <Detail label="Line-up" value={event.lineup.join(", ")} />
          <Detail label="Gêneros" value={event.genres.join(", ")} />
          <Detail label="Preço" value={formatPrice(event)} />
        </dl>
        {event.period === "future" ? <TicketAction event={event} /> : null}
      </main>
      <Footer asOf={options.asOf} />
      {jsonLd === undefined ? null : (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      )}
    </>,
    options,
    path,
  );
}

function EventRow({
  event,
  currentPath,
}: {
  readonly event: PublicEvent;
  readonly currentPath: string;
}): React.JSX.Element {
  const search = normalize(
    [event.title, event.venue, ...event.lineup, ...event.genres].join(" "),
  );
  return (
    <li>
      <article data-event data-search={search}>
        <time dateTime={event.date}>{formatDate(event.date)}</time>
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
          {event.start === undefined && event.showtime === undefined ? (
            <span>Horário a confirmar</span>
          ) : (
            <span>{formatTime(event.start) ?? formatTime(event.showtime)}</span>
          )}
          {formatPrice(event) === undefined ? null : (
            <span>{formatPrice(event)}</span>
          )}
          {event.status === undefined || event.status === "scheduled" ? null : (
            <span className="status">{statusLabels[event.status]}</span>
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
}: {
  readonly event: PublicEvent;
}): React.JSX.Element | null {
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
          Comprar ingressos
        </a>
      </p>
    );
  if (event.ticketsAtDoor) return <p>Ingressos na porta</p>;
  return event.ticketsExist ? <p>Ingressos disponíveis</p> : null;
}
function Search(): React.JSX.Element {
  return (
    <form className="search" role="search">
      <label htmlFor="event-search">Buscar por artista, local ou gênero</label>
      <input
        id="event-search"
        name="q"
        type="search"
        autoComplete="off"
        data-search-input
      />
      <button type="button" data-reset-search>
        Limpar
      </button>
    </form>
  );
}
function Footer({ asOf }: { readonly asOf: string }): React.JSX.Element {
  return (
    <footer>
      Atualizado em{" "}
      {new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(asOf))}
    </footer>
  );
}

function document(
  title: string,
  body: React.ReactNode,
  options: RenderOptions,
  currentPath: string,
): string {
  const canonical =
    options.baseUrl === undefined
      ? undefined
      : new URL(currentPath, options.baseUrl).toString();
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <title>{title}</title>
        <meta name="description" content="Agenda de música ao vivo." />
        {canonical === undefined ? null : (
          <link rel="canonical" href={canonical} />
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
): string | undefined {
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
    ...(event.ticketUrl === undefined
      ? {}
      : {
          offers: {
            "@type": "Offer",
            url: event.ticketUrl,
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
function relative(from: string, to: string): string {
  const up = from.split("/").length - 1;
  return `${"../".repeat(up)}${to}`;
}
function formatDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
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
export const defaultThemeCss = `:root{--color-background:#f7f0e3;--color-text:#17130f;--color-muted:#655d53;--color-accent:#c64020;--color-border:#c9bba8;--color-focus:#005fcc;--font-display:Georgia,serif;--font-body:system-ui,sans-serif}@media(prefers-color-scheme:dark){:root{--color-background:#17130f;--color-text:#f7f0e3;--color-muted:#c9bba8;--color-accent:#ff7350;--color-border:#655d53;--color-focus:#78b7ff}}`;
export const searchScript = `(()=>{const q=document.querySelector('[data-search-input]'),rows=[...document.querySelectorAll('[data-event]')],empty=document.querySelector('[data-no-results]'),reset=[...document.querySelectorAll('[data-reset-search]')];if(!q)return;const n=v=>v.normalize('NFD').replace(/\\p{M}/gu,'').toLocaleLowerCase('pt-BR');const apply=()=>{const value=n(q.value.slice(0,200));let count=0;for(const row of rows){const visible=row.dataset.search?.includes(value)??true;row.hidden=!visible;if(visible)count++}if(empty)empty.hidden=count!==0;const url=new URL(location.href);value?url.searchParams.set('q',q.value):url.searchParams.delete('q');history.replaceState(null,'',url)};q.value=new URL(location.href).searchParams.get('q')??'';q.addEventListener('input',apply);for(const button of reset)button.addEventListener('click',()=>{q.value='';apply();q.focus()});apply()})();`;
