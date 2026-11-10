/**
 * 어댑트 전달자료(ADAPT_업스테이지_전달자료_261109)를 읽는 스크립트 전용 헬퍼.
 * 자료는 data/adapt/ 아래에 두고 git에 올리지 않는다(어댑트 법무팀·담당자 한정 자료).
 *   data/adapt/spec/taxonomy.json, data/adapt/kb/00_INDEX.md, 01_COMMON_POSITIONS.md, playbooks/<ID>.md
 *   data/adapt/standards/*.docx
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/state";
import { OTHERS_KEY, OTHERS_NAME } from "@/lib/buckets";

export type AdaptCategory = {
  category_id: string;
  name_ko: string;
  name_en: string;
  group: string;
  standard_id: string | null;
  status: "standard_exists" | "standard_needed" | "out_of_scope";
  definition: string;
  include_signals: string[];
  exclude_signals: string[];
  languages: string[];
  adapt_role_default: string;
  observed_count_estimate: number | null;
  notes?: string;
};

const root = () => path.join(dataDir(), "adapt");

export function adaptTaxonomy(): AdaptCategory[] {
  const t = JSON.parse(fs.readFileSync(path.join(root(), "spec", "taxonomy.json"), "utf8")) as { categories: AdaptCategory[] };
  return t.categories;
}

/** 검토 범위 이름·추정 건수(어댑트 taxonomy에서 읽는다) */
export function bucketName(key: string) {
  if (key === OTHERS_KEY) return OTHERS_NAME;
  return adaptTaxonomy().find((c) => c.category_id === key)?.name_ko ?? key;
}
export function bucketEstimate(key: string) {
  return adaptTaxonomy().find((c) => c.category_id === key)?.observed_count_estimate ?? null;
}

export function commonPositions() {
  return fs.readFileSync(path.join(root(), "kb", "01_COMMON_POSITIONS.md"), "utf8");
}

export function indexDoc() {
  return fs.readFileSync(path.join(root(), "kb", "00_INDEX.md"), "utf8");
}

/** INDEX 2절(혼동 쌍 결정트리)만 */
export function decisionTree() {
  const s = indexDoc();
  const m = s.match(/## 2\. 판별 결정트리[\s\S]*?(?=\n## 3\.)/);
  return m ? m[0].trim() : "";
}

export function playbook(id: string) {
  return fs.readFileSync(path.join(root(), "kb", "playbooks", `${id}.md`), "utf8");
}

/** 플레이북 섹션 추출: "## 3." 형식 제목 기준 */
export function playbookSection(md: string, no: number) {
  const re = new RegExp(`\\n## ${no}\\.[\\s\\S]*?(?=\\n## \\d+\\.|$)`);
  return md.match(re)?.[0].trim() ?? "";
}

/** 프런트매터(--- ... ---) 값 */
export function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
