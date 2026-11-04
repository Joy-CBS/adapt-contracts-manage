import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * DB 핸들.
 * - DATABASE_URL이 있으면 Neon Postgres(Vercel 배포용)
 * - 없으면 로컬 PGlite(data/pglite, 설치 없이 동작하는 내장 Postgres)
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let _db: Promise<DB> | undefined;

export function db(): Promise<DB> {
  if (!_db) _db = connect();
  return _db;
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) return drizzleNeon(neon(url), { schema }) as unknown as DB;
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = path.resolve(process.env.DATA_DIR ?? "data", "pglite");
  return drizzle(new PGlite(dir), { schema }) as unknown as DB;
}

export async function migrateDb() {
  const url = process.env.DATABASE_URL;
  const folder = path.resolve("drizzle");
  const handle = await db();
  if (url) {
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    await migrate(handle as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle as never, { migrationsFolder: folder });
  }
}

export { schema };
