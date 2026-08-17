import { resolve } from "node:path";

import { openCatalogue } from "@event-database/catalogue";
import type { ReactNode } from "react";

export default async function Home(): Promise<ReactNode> {
  const catalogue = await openCatalogue({
    repositoryRoot: resolve(process.cwd(), "../.."),
    at: new Date(),
  });

  return <div>{catalogue.events.all().length} events</div>;
}
