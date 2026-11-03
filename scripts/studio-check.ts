/**
 * Studio 연결 점검: API 키·Project 설정이 맞는지 확인한다.
 *   npm run studio:check
 */
import "dotenv/config";
import { StudioClient, StudioApiError } from "@/lib/studio/client";

async function main() {
  const studio = new StudioClient();
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      console.log(`✔ ${label}`, r === undefined ? "" : r);
    } catch (e) {
      if (e instanceof StudioApiError) console.error(`✘ ${label}: ${e.message} (request-id ${e.requestId})`);
      else console.error(`✘ ${label}:`, e);
      process.exitCode = 1;
    }
  };

  await step("버전 조회", () => studio.version());
  await step("Agent 목록", async () => {
    const r = await studio.listAgents({ limit: 20 });
    return r.data.map((a) => `${a.id} ${a.name}`);
  });
  await step("Collection 목록", async () => {
    const r = await studio.listCollections({ limit: 20 });
    return r.data.map((c) => `${c.id} ${c.name}`);
  });
}

main();
