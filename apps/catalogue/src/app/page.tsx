import { openCatalogue } from "@event-database/catalogue";
import type { ReactNode } from "react";

export default async function Home(): Promise<ReactNode> {
  const catalogue = await openCatalogue({
    repositoryRoot:
      process.env.CATALOGUE_REPOSITORY_ROOT ??
      process.env.INIT_CWD ??
      process.cwd(),
    at: new Date(),
  });

  return <div>{catalogue.events.all().length} events</div>;
}
