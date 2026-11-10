/**
 * 로컬 분석 결과(data/)를 묶음으로 만들어 DB에 적재한다. 여러 번 실행해도 같은 결과가 된다.
 *   npm run db:seed                       # DATABASE_URL 없으면 로컬 PGlite에 적재
 *   npm run db:seed -- --bundle-only      # data/seed-bundle.json.gz만 생성 (배포 사이트 /admin에서 업로드)
 *
 * v3: 어댑트 분류체계 전체(49종) · 분류·추출 solar-pro4 · 리스크 검토 GPT(표준 25종 플레이북 + 공통 기준)
 *     계약서 보관함(기존 200건) + 검토 요청 샘플(기존에 없는 계약서 7건, 단계별)
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { db, migrateDb } from "@/db";
import { extracted, readJson } from "@/lib/contracts";
import { type SeedBundle, type SeedContract, seedBundle } from "@/lib/seed";
import { dataDir, loadState } from "@/lib/state";
import { type StandardDocV2, assessClassification, finalizeReview, reviewTargetOf, verdictOf } from "@/lib/review-types";
import { adaptTaxonomy, frontmatter, playbook, playbookSection } from "./lib/adapt-kb";
import { loadExtract } from "./v2-extract";
import { loadClassifyV3 } from "./v3-classify";
import { loadReviewV3, reviewTargets, targetChecklist } from "./v3-review";
import { loadRequests } from "./v3-requests";

const GROUP_ORDER = ["인플루언서·크리에이터", "광고·모델", "IP·라이선스", "용역·대행", "유통·공급", "제조", "NDA", "변경·해지", "기타"];
const REVIEW_MODEL_LABEL = "gpt (Studio 기본)";

function standardDoc(key: string, standardId: string, target: ReturnType<typeof reviewTargets>[number]): StandardDocV2 {
  const md = playbook(standardId);
  const fm = frontmatter(md);
  const std = readJson<{ title: string; sourceFile: string; paragraphs: StandardDocV2["paragraphs"] }>(`v3/standards/${standardId}.json`);
  const checklist = playbookSection(md, 3)
    .split("\n")
    .filter((l) => /^\s*(\d+\.|-)\s+/.test(l))
    .map((l) => l.replace(/^\s*(\d+\.|-)\s+/, "").trim());
  return {
    kind: "adapt_docx",
    bucket: key,
    standardId,
    title: std.title,
    sourceFile: std.sourceFile,
    version: fm.version ?? "",
    paragraphs: std.paragraphs,
    clauses: targetChecklist(target).map((e) => ({ title: e.title, grade: e.grade })),
    checklist,
    docxBase64: fs.readFileSync(path.join(dataDir(), "adapt", "standards", std.sourceFile)).toString("base64"),
  };
}

export function buildBundle(): SeedBundle {
  const tax = adaptTaxonomy();
  const names = new Map(tax.map((c) => [c.category_id, c.name_ko]));
  const nameOf = (k: string) => names.get(k) ?? k;
  const state = loadState();
  const cls = loadClassifyV3();
  const ext = loadExtract();
  const rev = loadReviewV3();
  const targets = reviewTargets(tax);
  const checklists = Object.fromEntries(targets.map((t) => [t.key, targetChecklist(t)]));

  const categories = tax.map((c) => ({
    key: c.category_id,
    name: c.name_ko,
    definition: c.definition,
    includeSignals: c.include_signals,
    excludeSignals: c.exclude_signals,
    standardId: c.status === "standard_exists" ? c.standard_id : null,
    hasStandard: c.status === "standard_exists" && Boolean(c.standard_id),
    estimate: c.observed_count_estimate ?? null,
    group: c.group,
    taxonomyStatus: c.status,
    sortOrder: (GROUP_ORDER.indexOf(c.group) + 1) * 100 + Math.max(0, 99 - Math.min(99, Math.round((c.observed_count_estimate ?? 0) / 10))),
  }));
  const standards = targets.filter((t) => t.standardId).map((t) => standardDoc(t.key, t.standardId!, t));

  const studio: Record<string, string> = {
    "v3.extract.agent": state.studio.v2ExtractAgentId ?? "",
    "v3.extract.config": state.studio.v2ExtractConfigId ?? "",
    "v3.classify.agent": state.studio.v3ClassifyAgentId ?? "",
    "v3.classify.config": state.studio.v3ClassifyConfigId ?? "",
    "v3.review.agent": state.studio.v3ReviewAgentId ?? "",
    ...Object.fromEntries(targets.map((t) => [`v3.review.config.${t.key}`, state.studio[`v3Review_${t.key}`] ?? ""])),
  };

  const review = (raw: NonNullable<ReturnType<typeof loadReviewV3>[string]["result"]>, target: string, jobId: string, checks?: unknown) => {
    const result = finalizeReview(raw, checklists[target] ?? []);
    return { jobId, target, model: REVIEW_MODEL_LABEL, verdict: verdictOf(result.items, result.is_high_value), result, checks };
  };

  // 계약서 보관함(기존 계약서)
  const legacy: SeedContract[] = Object.values(state.contracts)
    .filter((r) => r.status === "completed" && cls[r.sha256]?.status === "completed")
    .map((r) => {
      const c = cls[r.sha256];
      const classification = assessClassification({ model: "solar-pro4", label: c.label, rationale: c.rationale, nameOf });
      const type = classification.suggested;
      const rv = rev[r.sha256];
      const sp4 = ext[r.sha256];
      return {
        source: "legacy",
        sha256: r.sha256,
        path: r.path,
        folder: r.folder,
        filename: path.basename(r.path),
        fileId: r.fileId,
        extractJobId: sp4?.jobId ?? r.jobId,
        classifyJobId: c.jobId,
        type,
        classification,
        // 근거가 약한 건만 담당자 확인 대상으로 남긴다
        classifyState: classification.level === "weak" ? "suggested" : "approved",
        metadata: sp4?.status === "completed" && sp4.value ? sp4.value : extracted(r.sha256),
        review: rv?.status === "completed" && rv.result && rv.target === reviewTargetOf(type, tax) ? review(rv.result, rv.target, rv.jobId, rv.checks) : undefined,
      };
    });

  // 검토 요청 샘플: 단계가 섞이게(유형 확인 대기 / 변호사 요청 전 / 답변 대기 / 완료)
  const now = Date.now();
  const plan: Record<string, { hoursAgo: number; lawyer?: "open" | "requested" | "answered"; note?: string }> = {
    r1: { hoursAgo: 0.3, note: "TikTok Shop 어필리에이트 신규 크리에이터 계약입니다. 이번 주 안에 회신 필요." },
    r6: { hoursAgo: 0.8 },
    r7: { hoursAgo: 1.5, note: "샤오홍슈 달인 협업 계약. 표준이 없어 어떻게 볼지 확인 부탁드립니다." },
    r2: { hoursAgo: 3, lawyer: "open" },
    r4: { hoursAgo: 5, lawyer: "open", note: "소속사가 보낸 수정본입니다." },
    r3: { hoursAgo: 26, lawyer: "requested" },
    r5: { hoursAgo: 50, lawyer: "answered" },
  };
  const requests: SeedContract[] = Object.values(loadRequests())
    .filter((q) => q.status === "classified" || q.status === "reviewed")
    .map((q) => {
      const p = plan[q.key] ?? { hoursAgo: 2 };
      const classification = assessClassification({ model: "solar-pro4", label: q.label, rationale: q.rationale, nameOf });
      const rv = q.status === "reviewed" && q.review && q.reviewTarget ? review(q.review, q.reviewTarget, q.reviewJobId!) : undefined;
      const lawyerIdx = rv ? rv.result.items.map((x, i) => ({ x, i })).filter((y) => y.x.decision === "needs_lawyer") : [];
      const itemStates =
        p.lawyer && p.lawyer !== "open"
          ? lawyerIdx.map((y, k) => ({
              itemIndex: y.i,
              status: p.lawyer as "requested" | "answered",
              resolution: p.lawyer === "answered" ? (k % 3 === 2 ? "수정 요구" : "수용 가능") : undefined,
              answerNote: p.lawyer === "answered" && k % 3 === 2 ? "상대방에 표준 문구로 수정 요청" : undefined,
            }))
          : undefined;
      return {
        source: "upload",
        sha256: crypto.createHash("sha256").update(`request-sample:${q.fileId}`).digest("hex"),
        path: q.sourcePath,
        folder: q.sourcePath.split("/")[0],
        filename: q.filename,
        fileId: q.fileId,
        extractJobId: q.extractJobId,
        classifyJobId: q.classifyJobId,
        type: rv?.target && rv.target !== "common" && rv.target !== "tw_inf" ? rv.target : classification.suggested,
        classification,
        classifyState: rv ? "approved" : "suggested",
        metadata: q.extract ?? {},
        review: rv,
        stage: !rv ? "type_check" : p.lawyer === "answered" ? "done" : "reviewed",
        requestedAt: new Date(now - p.hoursAgo * 3600_000).toISOString(),
        completedAt: p.lawyer === "answered" ? new Date(now - (p.hoursAgo - 20) * 3600_000).toISOString() : undefined,
        requestNote: p.note,
        itemStates,
      };
    });

  return { version: 3, generated_at: new Date().toISOString(), categories, standards, checklists, studio, contracts: [...legacy, ...requests] };
}

async function main() {
  const bundle = buildBundle();
  const out = path.join(dataDir(), "seed-bundle.json.gz");
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(bundle)));
  const n = (f: (c: SeedContract) => boolean) => bundle.contracts.filter(f).length;
  console.log(
    `묶음 생성: ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)}MB) · 보관함 ${n((c) => c.source === "legacy")}건(검토 ${n((c) => c.source === "legacy" && !!c.review)}) · 요청 샘플 ${n((c) => c.source === "upload")}건`,
  );
  if (process.argv.includes("--bundle-only")) return;
  await migrateDb();
  console.log(await seedBundle(await db(), bundle));
}

if (process.argv[1]?.endsWith("db-seed.ts")) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
