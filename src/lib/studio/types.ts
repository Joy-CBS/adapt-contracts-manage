/**
 * Upstage Studio (Document Agent API v2) 응답 타입 중 이 PoC가 쓰는 부분만 정의한다.
 * 정본: https://api.upstage.ai/v2 공개 문서 (studio-pipeline/docs/public).
 */

export type StudioList<T> = {
  object: "list";
  data: T[];
  first_id?: string | null;
  last_id?: string | null;
  has_more: boolean;
};

export type StudioFile = {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  expires_at?: number | null;
  filename: string;
  purpose: string;
  status?: "PROCESSING" | "UPLOADED" | "READY" | "FAILED";
};

export type StudioAgent = {
  id: string;
  object: string;
  name: string;
  visibility?: "private" | "readonly" | "public";
  default_config_id?: string | null;
  created_at?: number;
};

export type StepType =
  | "import"
  | "document-parse"
  | "document-classify"
  | "information-extract"
  | "instruct"
  | "validate"
  | "match"
  | "merge"
  | "export"
  | "schema-generate"
  | "schema-update"
  | "class-generate"
  | "class-update"
  | "instruct-generate";

export type NextStep = {
  step_name: string;
  /** 분기 조건. 예: Classify 결과 text == "nda" */
  condition?: unknown;
};

export type ConfigStep = {
  id?: string;
  name: string;
  type: StepType;
  data: Record<string, unknown> | null;
  next_steps: NextStep[] | null;
  is_first: boolean;
};

export type StudioConfig = {
  id: string;
  object: "config";
  agent_id: string;
  name?: string | null;
  is_default: boolean;
  steps: ConfigStep[];
  created_at: number;
};

export type JobStatus =
  | "queued"
  | "in_progress"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type OutputContent = {
  type: string;
  text: string;
  /** JSON 문자열(신뢰도·위치·page_ranges 등) */
  additional_values?: string | null;
};

export type StudioResponse = {
  id: string;
  object: "response";
  status: JobStatus;
  model: string;
  error?: { code?: string; message?: string } | null;
  output: Array<{
    step_type?: StepType;
    step_name?: string;
    content: OutputContent[];
  }>;
  metadata?: Record<string, string> | null;
  created_at: number;
};

export type StudioError = {
  error: { code?: string; param?: string; type?: string; message?: string; details?: unknown };
};
