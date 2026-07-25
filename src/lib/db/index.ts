import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Lazily constructed database client.
 *
 * Deliberately not initialised at module load: `next build` imports modules to
 * collect metadata, and a top-level throw on a missing `DATABASE_URL` would fail
 * the build on a machine that has no database configured yet. Failing at first
 * query instead keeps the app deployable before Neon is wired up.
 */

type Database = ReturnType<typeof createClient>;

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }
  return drizzle(neon(url), { schema });
}

let cached: Database | null = null;

export function getDb(): Database {
  cached ??= createClient();
  return cached;
}

/** True when a connection string is present, for rendering setup state in the UI. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
