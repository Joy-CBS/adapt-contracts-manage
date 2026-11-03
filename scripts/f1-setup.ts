/**
 * F1 준비: 적재용 Studio Agent와 Config(studio/ingest.json)를 만든다.
 * - Agent가 이미 있으면 재사용한다.
 * - ingest.json 내용이 바뀌었을 때만 새 Config 버전을 만든다(Config는 불변).
 *   npm run f1:setup
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioClient } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";

async function main() {
  const studio = new StudioClient();
  const state = loadState();
  const raw = fs.readFileSync(path.resolve("studio/ingest.json"), "utf8");
  const def = JSON.parse(raw) as { name: string; steps: ConfigStep[] };
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);

  if (!state.studio.ingestAgentId) {
    const agent = await studio.createAgent("어댑트 계약서 적재 (F1)");
    state.studio.ingestAgentId = agent.id;
    saveState(state);
    console.log("Agent 생성:", agent.id);
  } else {
    console.log("Agent 재사용:", state.studio.ingestAgentId);
  }

  if (state.studio.ingestConfigHash === hash && state.studio.ingestConfigId) {
    console.log("Config 변경 없음:", state.studio.ingestConfigId);
    return;
  }
  const config = await studio.createConfig(state.studio.ingestAgentId!, def.steps, {
    name: def.name,
    isDefault: true,
  });
  state.studio.ingestConfigId = config.id;
  state.studio.ingestConfigHash = hash;
  saveState(state);
  console.log("Config 생성:", config.id, `(${config.steps.length} steps)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
