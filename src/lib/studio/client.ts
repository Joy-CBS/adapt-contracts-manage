import { studioEnv } from "@/lib/env";
import type {
  ConfigStep,
  StudioAgent,
  StudioConfig,
  StudioError,
  StudioFile,
  StudioList,
  StudioResponse,
} from "@/lib/studio/types";

/**
 * Upstage Studio(Document Agent API v2) 최소 클라이언트.
 * - 서버(라우트 핸들러·스크립트)에서만 사용한다. API 키를 브라우저로 보내지 않는다.
 * - 공개 v2 operation만 사용한다(studio-pipeline skills/document-agent-api/references/operations.md).
 */

const FINAL = new Set(["completed", "failed", "cancelled"]);

export class StudioApiError extends Error {
  constructor(
    public status: number,
    public body: StudioError | string,
    public requestId?: string | null,
  ) {
    const msg =
      typeof body === "string" ? body : `${body.error?.code ?? "error"}: ${body.error?.message ?? ""}`;
    super(`Studio API ${status} ${msg}`);
  }
}

type RequestOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** 429/5xx 재시도 횟수 */
  retries?: number;
};

export class StudioClient {
  private base: string;
  private key: string;
  private projectId?: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string; projectId?: string }) {
    const env = opts?.apiKey ? undefined : studioEnv();
    this.key = opts?.apiKey ?? env!.UPSTAGE_API_KEY;
    this.base = (opts?.baseUrl ?? env?.UPSTAGE_API_BASE ?? "https://api.upstage.ai").replace(/\/$/, "");
    this.projectId = opts?.projectId ?? env?.UPSTAGE_PROJECT_ID;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (this.projectId) headers["x-project-id"] = this.projectId;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form; // boundary는 fetch가 만든다
    }

    const retries = opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method: opts.method ?? "GET", headers, body });
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < retries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep((Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt) * 1000);
        continue;
      }
      const text = await res.text();
      let parsed: StudioError | string = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      throw new StudioApiError(res.status, parsed, res.headers.get("x-request-id"));
    }
  }

  // ---- Version ----
  version() {
    return this.request<Record<string, unknown>>("/v2/version");
  }

  // ---- Files ----
  async uploadFile(data: Blob, filename: string, opts?: { storePageImages?: boolean }) {
    const form = new FormData();
    form.append("file", data, filename);
    form.append("purpose", "user_data");
    if (opts?.storePageImages === false) form.append("store_page_images", "false");
    return this.request<StudioFile>("/v2/files", { method: "POST", form });
  }

  getFile(fileId: string) {
    return this.request<StudioFile>(`/v2/files/${fileId}`, { query: { view: "status" } });
  }

  listFiles(query?: { limit?: number; after?: string; name?: string }) {
    return this.request<StudioList<StudioFile>>("/v2/files", { query });
  }

  // ---- Agents & Configs ----
  createAgent(name: string, opts?: { createVectorStore?: boolean }) {
    return this.request<StudioAgent>("/v2/agents", {
      method: "POST",
      json: { name, visibility: "private", create_vector_store: opts?.createVectorStore ?? false },
    });
  }

  listAgents(query?: { q?: string; limit?: number; after?: string }) {
    return this.request<StudioList<StudioAgent>>("/v2/agents", { query });
  }

  getAgent(agentId: string) {
    return this.request<StudioAgent>(`/v2/agents/${agentId}`);
  }

  /** Config는 생성 후 steps를 바꿀 수 없다. 변경은 항상 새 Config 버전으로 만든다. */
  createConfig(agentId: string, steps: ConfigStep[], opts?: { name?: string; isDefault?: boolean }) {
    return this.request<StudioConfig>(`/v2/agents/${agentId}/configs`, {
      method: "POST",
      json: { name: opts?.name, is_default: opts?.isDefault ?? true, steps },
    });
  }

  listConfigs(agentId: string) {
    return this.request<StudioList<StudioConfig>>(`/v2/agents/${agentId}/configs`, {
      query: { order: "desc", limit: 100 },
    });
  }

  // ---- Responses (Workflow Jobs) ----
  runAgent(params: {
    agentId: string;
    fileIds: string[];
    configId?: string;
    instructions?: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }) {
    const content: Array<Record<string, unknown>> = params.fileIds.map((id) => ({
      type: "input_file",
      file_id: id,
    }));
    if (params.instructions) content.push({ type: "input_text", text: params.instructions });
    return this.request<StudioResponse>("/v2/responses", {
      method: "POST",
      idempotencyKey: params.idempotencyKey,
      json: {
        model: params.agentId,
        config_id: params.configId,
        input: [{ role: "user", content }],
        background: true,
        stream: false,
        metadata: params.metadata,
      },
    });
  }

  /** 예약 preset 실행(class-generate, schema-generate 등). body는 문서 계약 그대로 전달. */
  runPreset(body: Record<string, unknown>) {
    return this.request<StudioResponse>("/v2/responses", {
      method: "POST",
      json: { background: true, stream: false, ...body },
    });
  }

  getResponse(id: string, include: "last" | "all" = "last") {
    return this.request<StudioResponse>(`/v2/responses/${id}`, { query: { include } });
  }

  async waitForResponse(
    id: string,
    opts?: { include?: "last" | "all"; intervalMs?: number; timeoutMs?: number },
  ) {
    const deadline = Date.now() + (opts?.timeoutMs ?? 15 * 60_000);
    let interval = opts?.intervalMs ?? 2000;
    for (;;) {
      const r = await this.getResponse(id, opts?.include ?? "last");
      if (FINAL.has(r.status)) return r;
      if (Date.now() > deadline) throw new Error(`Studio job ${id} timed out (status=${r.status})`);
      await sleep(interval);
      interval = Math.min(interval * 1.5, 10_000);
    }
  }

  // ---- Collections ----
  listCollections(query?: { kind?: "table" | "documents"; include_default?: boolean; limit?: number }) {
    return this.request<StudioList<Record<string, unknown>>>("/v2/search-collections", { query });
  }

  getCollection(collectionId: string) {
    return this.request<Record<string, unknown>>(`/v2/search-collections/${collectionId}`);
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Step 결과 text(JSON 문자열)를 안전하게 파싱 */
export function parseStepText<T = unknown>(text: string | undefined | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
