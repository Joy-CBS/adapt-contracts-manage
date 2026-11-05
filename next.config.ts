import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬 내장 DB(PGlite)는 번들링하지 않고 node_modules에서 그대로 읽는다
  serverExternalPackages: ["@electric-sql/pglite"],
  // 관리 화면 적재 API가 배포 환경에서 마이그레이션 SQL을 읽을 수 있게 포함
  outputFileTracingIncludes: { "/api/admin/seed": ["./drizzle/**/*"] },
};

export default nextConfig;
