import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬 내장 DB(PGlite)는 번들링하지 않고 node_modules에서 그대로 읽는다
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
