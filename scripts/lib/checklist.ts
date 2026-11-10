/**
 * 검토 체크리스트: 어댑트 플레이북 2절(조항별 기준)과 01_COMMON_POSITIONS 표를 항목 단위로 쪼갠다.
 * 검토 Agent는 항목마다 사실(일치·일탈·누락, 알림 규칙 해당 여부 등)만 답하고,
 * "수정 필요 / 변호사 확인 / 참고" 결론은 앱이 항목의 등급·출처 태그로 정한다(review-types.decide).
 */
import { BUCKETS, type Bucket } from "@/lib/buckets";
import type { ChecklistEntry } from "@/lib/review-types";
import { commonPositions, playbook, playbookSection } from "./adapt-kb";

const GRADE = { "🔴": "high", "🟡": "medium", "🟢": "low" } as const;
const gradeOf = (s: string, fallback: ChecklistEntry["grade"] = "low"): ChecklistEntry["grade"] => {
  const m = s.match(/🔴|🟡|🟢/);
  return m ? GRADE[m[0] as keyof typeof GRADE] : fallback;
};
/** 공통 포지션 중 계약서에서 확인할 수 없는 운영 원칙(검토 항목에서 제외) */
const NOT_CHECKABLE = ["레드플래그", "소득 구분", "제품군"];
const tagsOf = (s: string) => [...new Set(s.match(/\[(표준|법무주석|법무확정|알림|제안)\]/g) ?? [])];

function playbookEntries(id: string, source: "playbook" | "reference"): Omit<ChecklistEntry, "id">[] {
  const sec = playbookSection(playbook(id), 2);
  const parts = sec.split(/\n(?=### )/).filter((p) => p.startsWith("### "));
  const out: Omit<ChecklistEntry, "id">[] = [];
  for (const p of parts) {
    const head = p.split("\n")[0].replace(/^### /, "");
    const body = p.split("\n").slice(1).join("\n").trim();
    if (head.startsWith("[추가 권고")) {
      // 표준에 없는 추가 권고 조항: "- A. 제목 🔴 [법무확정]: 내용" 줄마다 항목
      for (const line of body.split("\n").filter((l) => /^- [A-Z]\. /.test(l))) {
        const title = line.replace(/^- [A-Z]\. /, "").split(/\s*(?:🔴|🟡|🟢|\[|:|：)/)[0].trim();
        out.push({ title: `추가 권고: ${title}`, grade: gradeOf(line), source, tags: tagsOf(line), body: line.replace(/^- /, "") });
      }
      continue;
    }
    const [title, mark = ""] = head.split(/\s+—\s+/);
    out.push({ title: title.trim(), grade: gradeOf(mark), source, tags: tagsOf(body), body });
  }
  return out;
}

function commonEntries(): Omit<ChecklistEntry, "id">[] {
  const md = commonPositions();
  const out: Omit<ChecklistEntry, "id">[] = [];
  const [main, v11 = ""] = md.split(/\n## v1\.1/);
  for (const row of main.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 항목") && !l.startsWith("|---"))) {
    const [item, base, basis, deviation] = row.split("|").slice(1, -1).map((c) => c.trim());
    out.push({
      title: item,
      grade: gradeOf(deviation ?? "", "medium"),
      source: "common",
      tags: tagsOf(`${basis} ${deviation}`),
      body: `어댑트 기본값: ${base} / 근거: ${basis} / 이탈 시: ${deviation}`,
    });
  }
  for (const row of v11.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 항목") && !l.startsWith("|---"))) {
    const [item, rule, basis] = row.split("|").slice(1, -1).map((c) => c.trim());
    if (NOT_CHECKABLE.some((k) => item.startsWith(k))) continue;
    out.push({ title: item, grade: "medium", source: "common", tags: tagsOf(basis), body: `기준: ${rule} / 근거: ${basis}` });
  }
  return out;
}

export function checklistFor(b: Bucket): ChecklistEntry[] {
  let raw: Omit<ChecklistEntry, "id">[];
  if (b.hasStandard && b.standardId) raw = playbookEntries(b.standardId, "playbook");
  else if (b.referenceStandardId) raw = [...commonEntries(), ...playbookEntries(b.referenceStandardId, "reference")];
  else raw = commonEntries();
  return raw.map((e, i) => ({ id: `C${i + 1}`, ...e }));
}

export function allChecklists() {
  return Object.fromEntries(BUCKETS.map((b) => [b.key, checklistFor(b)]));
}

const MARK = { high: "🔴 필수", medium: "🟡 협상가능", low: "🟢 참고" } as const;

export function checklistForPrompt(list: ChecklistEntry[]) {
  return list
    .map((e) => `### ${e.id} · ${MARK[e.grade]}${e.source === "reference" ? " · 참고 기준(확정 아님)" : ""} · ${e.title}\n${e.body}`)
    .join("\n\n");
}
