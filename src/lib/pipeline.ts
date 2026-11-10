/**
 * Studio Job 응답 해석(스크립트·서버 공용). 파일 시스템·DB에 의존하지 않는다.
 */
import { parseStepText } from "@/lib/studio/client";
import type { RawReview, Rationale } from "@/lib/review-types";

type Output = { step_type: string; content?: Array<{ text?: string | null; additional_values?: string | null }> }[];

const stripCitations = (s?: string | null) => (s ?? "").replace(/【[^】]*†[^】]*】/g, "");

export function readClassify(output: Output | undefined) {
  const cls = output?.find((o) => o.step_type === "document-classify")?.content?.[0];
  const ins = output?.find((o) => o.step_type === "instruct")?.content?.[0];
  const extra = parseStepText<Record<string, unknown>>(cls?.additional_values ?? null);
  const conf = (extra?.document_type as { confidence_score?: unknown } | undefined)?.confidence_score;
  return {
    label: cls?.text?.replace(/^"|"$/g, "") ?? null,
    confidence: typeof conf === "number" ? conf : null,
    rationale: parseStepText<Rationale>(stripCitations(ins?.text)) ?? null,
  };
}

export function readExtract(output: Output | undefined) {
  const c = output?.find((o) => o.step_type === "information-extract")?.content?.[0];
  return parseStepText<Record<string, unknown>>(c?.text ?? null) ?? null;
}

export function readReview(output: Output | undefined) {
  const ins = output?.find((o) => o.step_type === "instruct")?.content?.[0];
  const val = output?.find((o) => o.step_type === "validate")?.content?.[0];
  const v = parseStepText<{ verdict?: string; checks?: Array<Record<string, unknown>> }>(val?.additional_values ?? null);
  return {
    raw: parseStepText<RawReview>(stripCitations(ins?.text).replace(/\s+(?=[.,])/g, "")) ?? null,
    studioVerdict: val?.text?.replace(/^"|"$/g, "") ?? null,
    checks: v ? { verdict: v.verdict, checks: (v.checks ?? []).map((x) => ({ name: x.name, severity: x.severity, passed: x.passed })) } : null,
  };
}

export const RUNNING = ["in_progress", "queued", "cancelling"];
