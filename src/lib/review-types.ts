/**
 * v2(어댑트 플레이북 기준) 분류·검토 결과 타입과 판단 규칙. 화면·스크립트 공용(파일 시스템 비의존).
 */
import { OTHERS_KEY, bucketOf } from "@/lib/buckets";

export type Signal = { signal: string; evidence: string };

export type Rationale = {
  document_kind: "contract" | "non_contract";
  primary_category_id: string;
  primary_fit: "강함" | "보통" | "약함";
  primary_reason: string;
  runner_up_category_id: string;
  runner_up_fit: "강함" | "보통" | "약함" | "해당 없음";
  runner_up_reason: string;
  matched_include_signals: Signal[];
  matched_exclude_signals: Array<Signal & { points_to: string }>;
  counterparty_kind: string;
  adapt_role: "standard" | "role_reversed" | "unclear";
  explanation: string;
};

export type EvidenceLevel = "strong" | "medium" | "weak";

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = { strong: "근거 충분", medium: "근거 보통", weak: "확인 필요" };

/**
 * 제안 유형: Studio Classify와 근거 분석(Rationale)이 다르면 근거 분석 쪽을 제안한다.
 * 근거 분석은 49종 정의·포함/제외 신호·결정트리를 모두 보고 판단하므로, 200건 실측에서 둘이 엇갈린 9건 중 8건은
 * 근거 분석이 다른 모델(GPT)과 같은 답이었다. 이 경우 근거 수준은 "확인 필요"로 남는다.
 */
export function suggestedBucket(label: string | undefined, r: Rationale | null | undefined) {
  if (!r || r.document_kind === "non_contract") return bucketOf(label);
  return bucketOf(r.primary_category_id);
}

/** DB contracts.classification */
export type Classification = {
  model: string;
  /** 화면에 제안하는 유형(검토 범위 키) */
  suggested: string;
  /** Studio Classify 결과(검토 범위 키) */
  label: string;
  /** Rationale이 고른 어댑트 세부 유형(taxonomy category_id) */
  subtypeId: string | null;
  rationaleBucket: string;
  agree: boolean;
  level: EvidenceLevel;
  /** 근거 수준을 그렇게 매긴 이유(화면 i 버튼) */
  reasons: Array<{ ok: boolean; text: string }>;
  rationale: Rationale | null;
  /** Studio 신뢰도(solar-pro4는 제공하지 않아 null) */
  confidence: number | null;
};

/** 근거 발췌의 HTML 태그(Parse 결과)를 걷어낸다 */
export function cleanEvidence(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const FIT_SCORE = { 강함: 3, 보통: 2, 약함: 1, "해당 없음": 0 } as const;

/**
 * 신뢰도 대체 지표: 두 가지 독립 판단의 일치 + 근거 신호의 양과 반대 신호로 "근거 수준"을 정한다.
 *  - 근거 충분: Classify와 Rationale이 같은 범위 + 1순위 적합도 강함 + 포함 신호 2개 이상 + 다른 범위를 가리키는 제외 신호·강한 2순위 없음
 *  - 확인 필요: 두 판단이 다름, 포함 신호 0개, 1순위 적합도 약함, 다른 범위를 가리키는 제외 신호, 2순위가 강함, 계약 본문 아님
 *  - 근거 보통: 그 밖
 */
export function assessClassification(input: {
  model: string;
  label: string;
  rationale: Rationale | null;
  confidence?: number | null;
  nameOf: (id: string) => string;
}): Classification {
  const { label, rationale: r } = input;
  const reasons: Classification["reasons"] = [];
  if (!r) {
    return {
      model: input.model,
      suggested: bucketOf(label),
      label,
      subtypeId: null,
      rationaleBucket: label,
      agree: false,
      level: "weak",
      reasons: [{ ok: false, text: "근거 분석 결과가 없어 담당자 확인이 필요합니다." }],
      rationale: null,
      confidence: input.confidence ?? null,
    };
  }
  const clean = {
    ...r,
    matched_include_signals: (r.matched_include_signals ?? []).map((s) => ({ ...s, evidence: cleanEvidence(s.evidence ?? "") })),
    matched_exclude_signals: (r.matched_exclude_signals ?? []).map((s) => ({ ...s, evidence: cleanEvidence(s.evidence ?? "") })),
  };
  const rb = bucketOf(r.primary_category_id);
  const agree = rb === label;
  const inc = clean.matched_include_signals.length;
  const ru = r.runner_up_category_id && r.runner_up_category_id !== "none" ? r.runner_up_category_id : null;
  const ruOtherBucket = ru ? bucketOf(ru) !== label : false;
  const ruScore = ru ? FIT_SCORE[r.runner_up_fit] ?? 0 : 0;
  // 제외 신호는 모델이 "해당 없음"까지 나열하는 경우가 있어(solar-pro4), 2순위 후보(적합도 보통 이상)로도 뒷받침될 때만 반대 신호로 센다
  const otherExcl = clean.matched_exclude_signals.filter(
    (s) => bucketOf(s.points_to) !== label && ruOtherBucket && ruScore >= 2 && bucketOf(s.points_to) === bucketOf(ru),
  );

  reasons.push(
    agree
      ? { ok: true, text: `Studio 분류(Classify)와 근거 분석(Rationale)이 같은 유형을 가리킵니다.` }
      : {
          ok: false,
          text: `두 판단이 다릅니다: Studio 분류 ${input.nameOf(label)} / 근거 분석 ${input.nameOf(r.primary_category_id)}. 분류 기준을 모두 대조한 근거 분석 쪽을 제안합니다.`,
        },
  );
  if (rb === OTHERS_KEY || label === OTHERS_KEY) {
    reasons.push({ ok: true, text: `세부 유형 추정: ${input.nameOf(r.primary_category_id)}` });
  }
  reasons.push(
    inc >= 2
      ? { ok: true, text: `분류 기준의 포함 신호 ${inc}개를 계약서에서 확인했습니다.` }
      : { ok: false, text: inc === 0 ? "분류 기준의 포함 신호를 계약서에서 찾지 못했습니다." : "포함 신호가 1개뿐입니다." },
  );
  reasons.push(
    r.primary_fit === "강함"
      ? { ok: true, text: "정의와의 적합도: 강함" }
      : { ok: r.primary_fit === "보통", text: `정의와의 적합도: ${r.primary_fit}` },
  );
  if (otherExcl.length) reasons.push({ ok: false, text: `다른 유형을 가리키는 제외 신호 ${otherExcl.length}개: ${otherExcl.map((s) => input.nameOf(s.points_to)).join(", ")}` });
  if (ru && ruOtherBucket && ruScore >= 2) reasons.push({ ok: false, text: `2순위 후보 ${input.nameOf(ru)}(적합도 ${r.runner_up_fit})도 가능성이 있습니다.` });
  if (r.document_kind === "non_contract") reasons.push({ ok: false, text: "계약 본문이 아닌 문서로 보입니다(감사추적인증서 등)." });

  let level: EvidenceLevel = "medium";
  const weak =
    !agree || inc === 0 || r.primary_fit === "약함" || otherExcl.length > 0 || (ruOtherBucket && ruScore >= 3) || r.document_kind === "non_contract";
  const strong = agree && r.primary_fit === "강함" && inc >= 2 && otherExcl.length === 0 && !(ruOtherBucket && ruScore >= 2);
  if (weak) level = "weak";
  else if (strong) level = "strong";

  return {
    model: input.model,
    suggested: suggestedBucket(label, r),
    label,
    subtypeId: r.primary_category_id ?? null,
    rationaleBucket: rb,
    agree,
    level,
    reasons,
    rationale: clean,
    confidence: input.confidence ?? null,
  };
}

/* ---------- 검토 v2 ---------- */

export type ReviewDecision = "ok" | "risk" | "needs_lawyer" | "note";
export type Grade = "high" | "medium" | "low";

/** 검토 체크리스트 항목(플레이북 조항 또는 공통 포지션 행) */
export type ChecklistEntry = {
  id: string; // C1, C2 ...
  title: string;
  grade: Grade;
  /** playbook=해당 유형 확정 플레이북, common=공통 포지션, reference=다른 유형 플레이북(참고만) */
  source: "playbook" | "common" | "reference";
  tags: string[];
  body: string;
};

/** 검토 Agent가 항목마다 답하는 사실(결론은 앱이 정한다) */
export type RawReviewItem = {
  item_id: string;
  grade: Grade;
  finding: "일치" | "일탈" | "누락" | "해당 없음";
  violates_confirmed: boolean;
  matched_alert: boolean;
  within_allowed: boolean;
  uncertain: boolean;
  standard_ref: string;
  contract_excerpt: string;
  issue: string;
  basis_tag: string;
  basis: string;
  lawyer_question: string;
  suggestion: string;
  suggestion_ko: string;
};

export type RawExtraClause = { title: string; contract_excerpt: string; issue: string; adverse: boolean; lawyer_question: string };

export type RawReview = {
  summary: string;
  overall_opinion: string;
  adapt_role: "standard" | "role_reversed" | "unclear";
  is_high_value: boolean;
  items: RawReviewItem[];
  extra_clauses: RawExtraClause[];
};

export type ReviewItem = {
  item_id: string;
  clause_ref: string;
  source: ChecklistEntry["source"] | "extra";
  standard_ref: string;
  finding: "일치" | "일탈" | "누락" | "추가조항" | "해당 없음";
  decision: ReviewDecision;
  /** 결론을 그렇게 정한 이유(화면 표시) */
  why: string;
  severity: Grade | "none";
  basis_tag: string;
  basis: string;
  contract_excerpt: string;
  issue: string;
  lawyer_question: string;
  suggestion: string;
  suggestion_ko: string;
  flags: { violates_confirmed: boolean; matched_alert: boolean; within_allowed: boolean; uncertain: boolean };
};

export type ReviewV2 = {
  summary: string;
  overall_opinion: string;
  adapt_role: "standard" | "role_reversed" | "unclear";
  is_high_value: boolean;
  items: ReviewItem[];
};

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  risk: "수정 필요",
  needs_lawyer: "변호사 확인",
  note: "참고",
  ok: "기준 충족",
};

const CONFIRMED = ["[표준]", "[법무주석]", "[법무확정]"];
const GRADE_KO: Record<Grade, string> = { high: "🔴 필수", medium: "🟡 협상가능", low: "🟢 참고" };

/**
 * 결론 규칙(어댑트 플레이북 스키마·INDEX 원칙):
 *  1. 기준과 같으면 기준 충족, 이 계약에 적용되지 않으면 참고
 *  2. 알림 규칙(레드플래그) 해당 → 자동 결론 없이 변호사 확인
 *  3. 문구가 불분명해 판단이 어려우면 → 변호사 확인
 *  4. 다른 유형의 참고 기준과 다름(표준 없는 유형) → 변호사 확인(🟢은 참고)
 *  5. 확정 기준([표준]·[법무주석]·[법무확정])이 결론까지 정한 위반 → 수정 필요
 *  6. 허용 가능 수정 범위 안 → 기준 충족
 *  7. 🔴 필수 조항 이탈·누락 → 변호사 판단 대상
 *  8. 🟡 조항 이탈 → 변호사 확인, 🟡 누락·🟢 차이 → 참고(추가 권고)
 */
export function decide(raw: RawReviewItem, entry: ChecklistEntry | undefined): Pick<ReviewItem, "decision" | "why"> {
  const grade = entry?.grade ?? raw.grade ?? "low";
  const confirmed = (entry?.tags ?? []).some((t) => CONFIRMED.includes(t));
  if ((raw.finding === "일치" || raw.finding === "해당 없음") && (raw.matched_alert || raw.violates_confirmed))
    return { decision: "needs_lawyer", why: "AI 답이 서로 어긋나(기준과 같다고 하면서 알림·위반 표시) 결론을 내리지 않았습니다." };
  if (raw.finding === "일치") return { decision: "ok", why: "기준과 같습니다." };
  if (raw.finding === "해당 없음") return { decision: "note", why: "이 계약에 적용되지 않는 기준입니다." };
  if (raw.matched_alert) return { decision: "needs_lawyer", why: "플레이북 알림 규칙(레드플래그)에 해당해 자동 결론 없이 변호사에게 넘깁니다." };
  if (raw.uncertain) return { decision: "needs_lawyer", why: "계약서 문구가 불분명해 AI가 판단하지 않았습니다." };
  if (entry?.source === "reference")
    return grade === "low"
      ? { decision: "note", why: "참고 기준과 다르지만 경미한 항목입니다." }
      : { decision: "needs_lawyer", why: "이 유형은 어댑트 확정 표준이 없어, 유사 표준과 다른 점은 변호사가 판단합니다." };
  if (raw.violates_confirmed && confirmed) return { decision: "risk", why: "법무팀 확정 기준이 결론까지 정해 둔 위반이라 수정이 필요합니다." };
  if (raw.within_allowed) return { decision: "ok", why: "기준과 다르지만 플레이북의 허용 가능 수정 범위 안입니다." };
  if (grade === "high") return { decision: "needs_lawyer", why: `${GRADE_KO.high} 조항의 ${raw.finding}입니다. 플레이북상 변호사 판단 대상입니다.` };
  if (grade === "medium" && raw.finding === "일탈") return { decision: "needs_lawyer", why: `${GRADE_KO.medium} 조항이 허용 범위를 벗어났는지 확정 기준이 없어 변호사 확인이 필요합니다.` };
  return { decision: "note", why: grade === "medium" ? "협상가능 조항의 누락입니다(추가 권고)." : "형식·기재사항 차이입니다." };
}

/** 검토 Agent 원답 + 체크리스트 → 화면용 검토 결과 */
export function finalizeReview(raw: RawReview, checklist: ChecklistEntry[]): ReviewV2 {
  const byId = new Map(checklist.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const items: ReviewItem[] = [];
  for (const r of raw.items ?? []) {
    const id = String(r.item_id ?? "").trim();
    const entry = byId.get(id);
    if (!entry || seen.has(id)) continue;
    seen.add(id);
    const { decision, why } = decide(r, entry);
    items.push({
      item_id: id,
      clause_ref: entry.title,
      source: entry.source,
      standard_ref: (r.standard_ref ?? "").trim().split(/[-,~\s]/)[0],
      finding: r.finding,
      decision,
      why,
      severity: decision === "ok" ? "none" : entry.grade,
      basis_tag: r.basis_tag,
      basis: r.basis,
      contract_excerpt: r.contract_excerpt ?? "",
      issue: decision === "ok" && r.finding === "일치" ? "" : r.issue ?? "",
      lawyer_question:
        decision === "needs_lawyer" ? r.lawyer_question?.trim() || `${entry.title}: ${r.issue || "수용 여부를 확인해 주세요."}` : "",
      suggestion: decision === "risk" ? r.suggestion ?? "" : "",
      suggestion_ko: decision === "risk" ? r.suggestion_ko ?? "" : "",
      flags: { violates_confirmed: !!r.violates_confirmed, matched_alert: !!r.matched_alert, within_allowed: !!r.within_allowed, uncertain: !!r.uncertain },
    });
  }
  // 답이 빠진 체크리스트 항목은 결론 없이 남긴다
  for (const e of checklist) {
    if (seen.has(e.id)) continue;
    items.push({
      item_id: e.id,
      clause_ref: e.title,
      source: e.source,
      standard_ref: "",
      finding: "누락",
      decision: e.grade === "high" ? "needs_lawyer" : "note",
      why: "AI가 이 항목을 답하지 않았습니다. 사람이 확인해야 합니다.",
      severity: e.grade,
      basis_tag: "",
      basis: "",
      contract_excerpt: "",
      issue: "검토 결과가 비어 있습니다.",
      lawyer_question: e.grade === "high" ? `${e.title}: 계약서의 해당 조항을 확인해 주세요.` : "",
      suggestion: "",
      suggestion_ko: "",
      flags: { violates_confirmed: false, matched_alert: false, within_allowed: false, uncertain: true },
    });
  }
  items.sort((a, b) => Number(a.item_id.slice(1)) - Number(b.item_id.slice(1)));
  (raw.extra_clauses ?? []).slice(0, 5).forEach((x, i) => {
    items.push({
      item_id: `X${i + 1}`,
      clause_ref: `상대방 추가 조항: ${x.title}`,
      source: "extra",
      standard_ref: "",
      finding: "추가조항",
      decision: x.adverse ? "needs_lawyer" : "note",
      why: x.adverse ? "표준에 없는 조항이 어댑트에 불리할 수 있어 변호사 확인이 필요합니다." : "표준에 없는 조항입니다(참고).",
      severity: x.adverse ? "medium" : "low",
      basis_tag: "",
      basis: "",
      contract_excerpt: x.contract_excerpt ?? "",
      issue: x.issue ?? "",
      lawyer_question: x.adverse ? x.lawyer_question || `${x.title}: 수용 여부를 확인해 주세요.` : "",
      suggestion: "",
      suggestion_ko: "",
      flags: { violates_confirmed: false, matched_alert: false, within_allowed: false, uncertain: false },
    });
  });
  return { summary: raw.summary, overall_opinion: raw.overall_opinion, adapt_role: raw.adapt_role, is_high_value: !!raw.is_high_value, items };
}

export function countItems(items: ReviewItem[]) {
  const c = { risk: 0, riskHigh: 0, riskMedium: 0, lawyer: 0, note: 0, ok: 0 };
  for (const it of items) {
    if (it.decision === "risk") {
      c.risk++;
      if (it.severity === "high") c.riskHigh++;
      if (it.severity === "medium") c.riskMedium++;
    } else if (it.decision === "needs_lawyer") c.lawyer++;
    else if (it.decision === "note") c.note++;
    else c.ok++;
  }
  return c;
}

/** 판정: 수정 필요 항목이 있으면 red, 변호사 확인 항목(또는 1억 원 이상)이 있으면 yellow, 아니면 green */
export function verdictOf(items: ReviewItem[], highValue: boolean): "red" | "yellow" | "green" {
  const c = countItems(items);
  if (c.risk > 0) return "red";
  if (c.lawyer > 0 || highValue) return "yellow";
  return "green";
}

/** 표준계약서(어댑트 원본 docx) */
export type StandardDocV2 = {
  kind: "adapt_docx";
  bucket: string;
  standardId: string;
  title: string;
  sourceFile: string;
  version: string;
  paragraphs: Array<{ id: string; index: number; text: string }>;
  /** 플레이북 2절 조항 제목과 등급 */
  clauses: Array<{ title: string; grade: "high" | "medium" | "low" | "none" }>;
  /** 플레이북 3절 필수 체크리스트 */
  checklist: string[];
  docxBase64: string;
};
