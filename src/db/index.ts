import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * DB 핸들.
 * - Postgres 접속 문자열이 있으면 Neon Postgres(Vercel 배포용)
 * - 없으면 로컬 PGlite(data/pglite, 설치 없이 동작하는 내장 Postgres). Vercel에서는 사용하지 않는다.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * 접속 문자열을 찾는다. Vercel의 Neon 연동은 설정에 따라 이름 앞에 접두어가 붙을 수 있어
 * (예: STORAGE_DATABASE_URL) 표준 이름 다음에 *_DATABASE_URL, *_POSTGRES_URL도 확인한다.
 */
export function resolveDatabaseUrl(): { name: string; url: string } | null {
  const env = process.env;
  for (const name of ["DATABASE_URL", "POSTGRES_URL"]) if (env[name]) return { name, url: env[name]! };
  const keys = Object.keys(env).sort();
  const hit =
    keys.find((k) => /_DATABASE_URL$/.test(k) && !/UNPOOLED/.test(k) && env[k]) ??
    keys.find((k) => /_POSTGRES_URL$/.test(k) && env[k]);
  return hit ? { name: hit, url: env[hit]! } : null;
}

export function dbMode(): { mode: "neon" | "pglite" | "missing"; envVar?: string } {
  const r = resolveDatabaseUrl();
  if (r) return { mode: "neon", envVar: r.name };
  return process.env.VERCEL ? { mode: "missing" } : { mode: "pglite" };
}

// Next.js는 페이지·서버 액션을 다른 번들로 나눠 모듈 변수가 둘 이상 생길 수 있다.
// 로컬 PGlite는 같은 폴더를 두 인스턴스가 열면 서로의 쓰기를 못 보므로 프로세스 전역에 하나만 둔다.
const g = globalThis as unknown as { __acrDb?: Promise<DB> };

export function db(): Promise<DB> {
  if (!g.__acrDb) {
    g.__acrDb = connect();
    g.__acrDb.catch(() => (g.__acrDb = undefined)); // 실패하면 다음 요청에서 다시 시도
  }
  return g.__acrDb;
}

async function connect(): Promise<DB> {
  const r = resolveDatabaseUrl();
  if (r) return drizzleNeon(neon(r.url), { schema }) as unknown as DB;
  if (process.env.VERCEL) {
    throw new Error(
      "DB 접속 정보(DATABASE_URL)가 없습니다. Vercel Storage에서 Neon DB를 이 프로젝트에 연결(Connect)한 뒤 Redeploy 하세요.",
    );
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = path.resolve(process.env.DATA_DIR ?? "data", "pglite");
  return drizzle(new PGlite(dir), { schema }) as unknown as DB;
}

export async function migrateDb() {
  const folder = path.resolve("drizzle");
  const handle = await db();
  if (resolveDatabaseUrl()) {
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    await migrate(handle as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle as never, { migrationsFolder: folder });
  }
}

/** drizzle 오류는 실제 원인이 cause에 있어 함께 보여준다 */
export function describeDbError(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string } };
  const head = String(err?.message ?? e).split("\n")[0];
  const cause = err?.cause?.message;
  return cause ? `${head} → 원인: ${cause}` : head;
}

export { schema };
