import fs from "node:fs";
import path from "node:path";

/**
 * 로컬 스크립트용 상태 파일(data/state.json).
 * DB가 연결되기 전까지 Studio 리소스 ID와 처리 진행 상황을 여기에 기록한다.
 * data/는 개인정보가 포함될 수 있어 git에 올리지 않는다.
 */

export type ContractRecord = {
  path: string; // 원본 폴더 기준 상대 경로
  folder: string;
  sha256: string;
  fileId?: string;
  jobId?: string;
  status?: "uploaded" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
};

export type State = {
  studio: {
    ingestAgentId?: string;
    ingestConfigId?: string;
    ingestConfigHash?: string;
    [key: string]: string | undefined;
  };
  contracts: Record<string, ContractRecord>; // key = sha256
};

export function dataDir() {
  return path.resolve(process.env.DATA_DIR ?? "data");
}

const statePath = () => path.join(dataDir(), "state.json");

export function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8")) as State;
  } catch {
    return { studio: {}, contracts: {} };
  }
}

export function saveState(s: State) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 1));
}
