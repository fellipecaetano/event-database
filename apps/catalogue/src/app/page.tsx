import { openCatalogue, CatalogueFact } from "@event-database/catalogue";
import type { ReactNode } from "react";
import styles from "@/app/page.module.css";

export default async function Home(): Promise<ReactNode> {
  const catalogue = await openCatalogue({
    repositoryRoot:
      process.env.CATALOGUE_REPOSITORY_ROOT ??
      process.env.INIT_CWD ??
      process.cwd(),
    at: new Date(),
  });

  const allEvents = catalogue.events.all();

  return (
    <main>
      <ul className={styles.listing}>
        {allEvents.map((event) => {
          const title = CatalogueFact.valueIfKnown(event.facts.title);
          const date = CatalogueFact.valueIfKnown(event.facts.date);
          const venueName = CatalogueFact.valueIfKnown(event.facts.venueName);
          const time = CatalogueFact.valueIfKnown(event.facts.start);
          const price = CatalogueFact.valueIfKnown(event.facts.priceFrom);

          return (
            <li key={event.id}>
              <article className={styles.event}>
                <div className={styles.date}>
                  <time dateTime={date}>{date}</time>
                </div>
                <div className={styles.details}>
                  <h2>{title}</h2>
                  <p>{venueName}</p>
                </div>
                <div className={styles.info}>
                  <span>{time}</span>
                  <span>{price}</span>
                </div>
              </article>
              <hr />
            </li>
          );
        })}
      </ul>
    </main>
  );
}
