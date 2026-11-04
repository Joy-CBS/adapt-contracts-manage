import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/state";

/** 공통 도메인 타입과 로컬 data/ 접근 헬퍼(스크립트용) */

export type Category = {
  class_key: string;
  name: string;
  definition: string;
  include_criteria: string;
  exclude_criteria: string;
  typical_clauses: string[];
  standardizable: boolean;
  standardizable_reason: string;
  member_ids: number[];
};

export type TemplateClause = {
  no: number;
  title_ko: string;
  title_en: string;
  text_ko: string;
  text_en: string;
  guardrail: string;
  risk_if_deviating: string;
  severity_if_deviating: "high" | "medium" | "low";
  kind: "legal" | "commercial";
};

export type StandardTemplate = {
  class_key: string;
  title_ko: string;
  title_en: string;
  preamble_ko: string;
  preamble_en: string;
  clauses: TemplateClause[];
  notes: string;
  source: "representative" | "generated_draft" | "adapt_original";
  representative_sha256?: string;
  status: "draft" | "confirmed";
};

export type ClauseReview = {
  standard_clause_no: number;
  standard_clause_title: string;
  status: "일치" | "일탈" | "누락" | "추가조항";
  severity: "high" | "medium" | "low" | "none";
  contract_excerpt: string;
  issue: string;
  suggestion: string;
  suggestion_ko: string;
};

export type ReviewResult = {
  summary: string;
  overall_opinion: string;
  is_high_value: boolean;
  clause_reviews: ClauseReview[];
};

export type Extracted = Record<string, unknown> & {
  contract_title?: string;
  contract_type?: string;
  language?: string;
  amount?: number;
  currency?: string;
};

export function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir(), rel), "utf8")) as T;
}

export function exists(rel: string) {
  return fs.existsSync(path.join(dataDir(), rel));
}

export function writeJson(rel: string, value: unknown) {
  const p = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 1));
}

/** F1 Parse 결과에서 평문 텍스트를 꺼낸다 */
export function parseText(sha256: string): string {
  const p = path.join(dataDir(), "f1", "parse", `${sha256}.txt`);
  if (!fs.existsSync(p)) return "";
  const raw = fs.readFileSync(p, "utf8");
  try {
    const j = JSON.parse(raw);
    return j?.content?.text ?? j?.content?.markdown ?? "";
  } catch {
    return raw;
  }
}

export function extracted(sha256: string): Extracted {
  const p = path.join(dataDir(), "f1", "extract", `${sha256}.json`);
  if (!fs.existsSync(p)) return {};
  return (JSON.parse(fs.readFileSync(p, "utf8")).value ?? {}) as Extracted;
}

/** 실행 시점 동시성 제한 map */
export async function pmap<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}
