import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let pool: Pool | undefined;
let db: Database | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

export async function pingDatabase(): Promise<void> {
  await getPool().query("select 1");
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
