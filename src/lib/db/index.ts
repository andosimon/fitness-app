import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Lazily constructed database client.
 *
 * Deliberately not initialised at module load: `next build` imports modules to
 * collect metadata, and a top-level throw on a missing connection string would
 * fail the build on a machine with no database configured yet. Failing at first
 * query instead keeps the app deployable before Neon is wired up.
 */

/**
 * Connection string sources, in priority order.
 *
 * `FITNESS_DATABASE_URL` comes first because Vercel's Neon integration installs
 * `DATABASE_URL` as a *managed* variable that cannot be edited in the dashboard,
 * and it points at the Neon project's default database. This app needs its own
 * database, so an explicit override is the only way to redirect it without
 * disconnecting the integration.
 */
const CONNECTION_ENV_VARS = ["FITNESS_DATABASE_URL", "DATABASE_URL"] as const;

type Connection = { url: string; source: (typeof CONNECTION_ENV_VARS)[number] };

export function resolveConnection(): Connection | null {
  for (const source of CONNECTION_ENV_VARS) {
    const url = process.env[source];
    if (url && url.trim() !== "") return { url, source };
  }
  return null;
}

type Database = ReturnType<typeof createClient>;

function createClient() {
  const connection = resolveConnection();
  if (!connection) {
    throw new Error(
      `No database connection string. Set one of: ${CONNECTION_ENV_VARS.join(", ")}. ` +
        "Copy .env.example to .env.local to get started.",
    );
  }
  return drizzle(neon(connection.url), { schema });
}

let cached: Database | null = null;

export function getDb(): Database {
  cached ??= createClient();
  return cached;
}

/** True when a connection string is present, for rendering setup state. */
export function isDatabaseConfigured(): boolean {
  return resolveConnection() !== null;
}

export { schema };
