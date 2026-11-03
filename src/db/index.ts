import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { dbEnv } from "@/lib/env";
import * as schema from "@/db/schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Vercel 서버리스·스크립트 공용 DB 핸들(Neon Postgres, HTTP 드라이버) */
export function db() {
  if (!_db) _db = drizzle(neon(dbEnv().DATABASE_URL), { schema });
  return _db;
}

export { schema };
