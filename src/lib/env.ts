import { z } from "zod";

/**
 * 서버 전용 환경 변수. 키 값은 절대 클라이언트 번들로 내보내지 않는다.
 * 필요한 값만 꺼내 쓰도록 섹션별 getter로 나눈다(빌드 시 없는 값 때문에 전체가 실패하지 않게).
 */
const studioSchema = z.object({
  UPSTAGE_API_KEY: z.string().min(1, "UPSTAGE_API_KEY가 필요합니다"),
  UPSTAGE_API_BASE: z.string().url().default("https://api.upstage.ai"),
  UPSTAGE_PROJECT_ID: z.string().optional(),
});

const dbSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 필요합니다"),
});

export function studioEnv() {
  return studioSchema.parse(process.env);
}

export function dbEnv() {
  return dbSchema.parse(process.env);
}

export function demoPassword(): string | undefined {
  return process.env.DEMO_PASSWORD || undefined;
}
