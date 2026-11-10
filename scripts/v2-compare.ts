/**
 * GPT(Studio 기본 gpt-5.4) vs solar-pro4 기능별 비교 지표.
 *   npx tsx scripts/v2-compare.ts            # data/v2/analysis/compare.json + compare.md
 * 정답 세트가 아직 없어(어댑트 검수 세트 예정) 두 모델의 일치도·자기 일관성·채움률·속도·실패율로 비교한다.
 */
import "dotenv/config";
import { StudioClient } from "@/lib/studio/client";
import { exists, extracted, pmap, readJson, writeJson } from "@/lib/contracts";
import { loadState } from "@/lib/state";
import { bucketOf } from "@/lib/buckets";
import { assessClassification, countItems, finalizeReview, verdictOf } from "@/lib/review-types";
import { adaptTaxonomy } from "./lib/adapt-kb";
import { allChecklists } from "./lib/checklist";
import { type StepTiming, loadClassify, stepTimings } from "./v2-classify";
import { loadExtract } from "./v2-extract";
import { loadReview } from "./v2-review";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pctile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const pc = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const secOf = (t: StepTiming[] | undefined, step: string) => t?.find((x) => x.step === step)?.seconds ?? null;
const nums = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === "number");

async function gptExtractTimings() {
  const rel = "v2/analysis/gpt-extract-timing.json";
  const cache: Record<string, { timing: StepTiming[]; usage: unknown }> = exists(rel) ? readJson(rel) : {};
  const state = loadState();
  const todo = Object.values(state.contracts).filter((r) => r.jobId && !cache[r.sha256]);
  if (todo.length) {
    const studio = new StudioClient();
    await pmap(todo, 8, async (r) => {
      try {
        const res = await studio.getResponse(r.jobId!, "all");
        cache[r.sha256] = { timing: stepTimings(res.output as unknown as Array<Record<string, unknown>>), usage: (res as { usage?: unknown }).usage ?? null };
      } catch {
        /* 건너뜀 */
      }
    });
    writeJson(rel, cache);
  }
  return cache;
}

const norm = (v: unknown) =>
  (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).sort().join("|") : String(v ?? "").trim().toLowerCase()).replace(/\s+/g, " ");
const empty = (v: unknown) => v == null || (Array.isArray(v) ? v.length === 0 : ["", "없음", "none", "n/a"].includes(String(v).trim().toLowerCase()));

async function main() {
  const tax = adaptTaxonomy();
  const name = (id: string) => tax.find((c) => c.category_id === id)?.name_ko ?? id;
  const state = loadState();
  const shas = Object.values(state.contracts).filter((r) => r.status === "completed").map((r) => r.sha256);
  const out: Record<string, unknown> = { generated_at: new Date().toISOString(), contracts: shas.length };

  /* ---------- 1. 분류 ---------- */
  const cs = loadClassify("sp4");
  const cg = loadClassify("gpt");
  const both = shas.filter((s) => cs[s]?.status === "completed" && cg[s]?.status === "completed");
  const dist = (m: typeof cs) =>
    both.reduce<Record<string, number>>((a, s) => ((a[m[s].label ?? "-"] = (a[m[s].label ?? "-"] ?? 0) + 1), a), {});
  const labelAgree = both.filter((s) => cs[s].label === cg[s].label).length;
  const subAgree = both.filter((s) => cs[s].rationale?.primary_category_id && cs[s].rationale?.primary_category_id === cg[s].rationale?.primary_category_id).length;
  const selfConsistent = (m: typeof cs) => both.filter((s) => m[s].rationale && bucketOf(m[s].rationale!.primary_category_id) === m[s].label).length;
  const levels = (m: typeof cs, model: string) =>
    both.reduce<Record<string, number>>((a, s) => {
      const lv = assessClassification({ model, label: m[s].label ?? "others", rationale: m[s].rationale ?? null, confidence: m[s].confidence, nameOf: name }).level;
      a[lv] = (a[lv] ?? 0) + 1;
      return a;
    }, {});
  const sig = (m: typeof cs) => avg(both.map((s) => m[s].rationale?.matched_include_signals?.length ?? 0));
  const htmlEvidence = (m: typeof cs) => both.filter((s) => (m[s].rationale?.matched_include_signals ?? []).some((x) => /<[a-z][^>]*>/i.test(x.evidence))).length;
  const runnerUp = (m: typeof cs) => both.filter((s) => m[s].rationale?.runner_up_category_id && m[s].rationale?.runner_up_category_id !== "none").length;
  const confs = nums(both.map((s) => cg[s].confidence));
  const disagreements = both
    .filter((s) => cs[s].label !== cg[s].label)
    .map((s) => ({
      sha: s.slice(0, 10),
      path: state.contracts[s].path,
      sp4: cs[s].label,
      gpt: cg[s].label,
      sp4_sub: cs[s].rationale?.primary_category_id,
      gpt_sub: cg[s].rationale?.primary_category_id,
      gpt_conf: cg[s].confidence,
    }));
  // GPT 신뢰도 구간별 두 모델 일치율(신뢰도가 일치도를 설명하는지)
  const confBands = [
    [0.95, 1.01],
    [0.85, 0.95],
    [0, 0.85],
  ].map(([lo, hi]) => {
    const xs = both.filter((s) => (cg[s].confidence ?? -1) >= lo && (cg[s].confidence ?? -1) < hi);
    return { band: `${lo}~${hi > 1 ? 1 : hi}`, n: xs.length, agree: pc(xs.filter((s) => cs[s].label === cg[s].label).length, xs.length) };
  });
  // SP4 근거 수준별 두 모델 일치율(대체 지표가 일치도를 설명하는지)
  const levelBands = ["strong", "medium", "weak"].map((lv) => {
    const xs = both.filter(
      (s) => assessClassification({ model: "sp4", label: cs[s].label ?? "others", rationale: cs[s].rationale ?? null, nameOf: name }).level === lv,
    );
    return { level: lv, n: xs.length, agreeWithGpt: pc(xs.filter((s) => cs[s].label === cg[s].label).length, xs.length) };
  });
  const tm = (m: typeof cs, step: string) => nums(both.map((s) => secOf(m[s].timing, step)));
  out.classify = {
    n: both.length,
    failed: { sp4: shas.filter((s) => cs[s]?.status === "failed").length, gpt: shas.filter((s) => cg[s]?.status === "failed").length },
    rationaleParseFail: { sp4: both.filter((s) => !cs[s].rationale).length, gpt: both.filter((s) => !cg[s].rationale).length },
    distribution: { sp4: dist(cs), gpt: dist(cg) },
    labelAgreement: pc(labelAgree, both.length),
    subtypeAgreement: pc(subAgree, both.length),
    selfConsistency: { sp4: pc(selfConsistent(cs), both.length), gpt: pc(selfConsistent(cg), both.length) },
    evidenceLevels: { sp4: levels(cs, "sp4"), gpt: levels(cg, "gpt") },
    avgIncludeSignals: { sp4: r1(sig(cs)), gpt: r1(sig(cg)) },
    evidenceWithHtml: { sp4: htmlEvidence(cs), gpt: htmlEvidence(cg) },
    runnerUpFilled: { sp4: pc(runnerUp(cs), both.length), gpt: pc(runnerUp(cg), both.length) },
    gptConfidence: { available: confs.length, avg: r1(avg(confs) * 100), min: Math.min(...confs), below85: confs.filter((c) => c < 0.85).length },
    sp4Confidence: "제공 안 됨(logprobs 미지원, Studio가 confidence를 끔)",
    agreementByGptConfidence: confBands,
    agreementBySp4EvidenceLevel: levelBands,
    seconds: {
      classify: { sp4: { avg: r1(avg(tm(cs, "document-classify"))), p90: pctile(tm(cs, "document-classify"), 90) }, gpt: { avg: r1(avg(tm(cg, "document-classify"))), p90: pctile(tm(cg, "document-classify"), 90) } },
      rationale: { sp4: { avg: r1(avg(tm(cs, "instruct"))), p90: pctile(tm(cs, "instruct"), 90) }, gpt: { avg: r1(avg(tm(cg, "instruct"))), p90: pctile(tm(cg, "instruct"), 90) } },
    },
    tokens: {
      sp4: Math.round(avg(nums(both.map((s) => cs[s].usage?.total_tokens)))),
      gpt: Math.round(avg(nums(both.map((s) => cg[s].usage?.total_tokens)))),
    },
    disagreements,
  };

  /* ---------- 2. 정보 추출 ---------- */
  const es = loadExtract();
  const gt = await gptExtractTimings();
  const eboth = shas.filter((s) => es[s]?.status === "completed" && es[s].value && exists(`f1/extract/${s}.json`));
  const fields = Object.keys(extracted(eboth[0]) ?? {});
  const perField = fields.map((f) => {
    let agree = 0;
    let fillS = 0;
    let fillG = 0;
    let bothFilled = 0;
    for (const s of eboth) {
      const a = es[s].value![f];
      const b = (extracted(s) as Record<string, unknown>)[f];
      if (!empty(a)) fillS++;
      if (!empty(b)) fillG++;
      if (!empty(a) && !empty(b)) {
        bothFilled++;
        if (norm(a) === norm(b)) agree++;
      }
    }
    return { field: f, fill_sp4: pc(fillS, eboth.length), fill_gpt: pc(fillG, eboth.length), exactAgree: pc(agree, bothFilled) };
  });
  const exactFields = ["language", "signed_date", "currency", "amount", "adapt_entity", "counterparty_type", "adapt_role", "contract_title"];
  const koSummary = (v: unknown) => /[가-힣]/.test(String(v ?? ""));
  const sumFields = ["scope_summary", "deliverables", "term", "payment_terms"];
  const koRate = (get: (s: string) => Record<string, unknown>) =>
    pc(eboth.reduce((a, s) => a + sumFields.filter((f) => !empty(get(s)[f]) && koSummary(get(s)[f])).length, 0), eboth.reduce((a, s) => a + sumFields.filter((f) => !empty(get(s)[f])).length, 0));
  const exS = nums(eboth.map((s) => secOf(es[s].timing, "information-extract")));
  const exG = nums(eboth.map((s) => secOf(gt[s]?.timing, "information-extract")));
  out.extract = {
    n: eboth.length,
    failed: { sp4: shas.filter((s) => es[s]?.status === "failed").length },
    keyFields: perField.filter((p) => exactFields.includes(p.field)),
    allFields: perField,
    avgFill: { sp4: r1(avg(perField.map((p) => p.fill_sp4))), gpt: r1(avg(perField.map((p) => p.fill_gpt))) },
    koreanSummaryRate: { sp4: koRate((s) => es[s].value!), gpt: koRate((s) => extracted(s) as Record<string, unknown>) },
    confidence: { sp4: "없음(Studio가 강제로 끔)", gpt: "필드별 신뢰도 제공" },
    seconds: { sp4: { avg: r1(avg(exS)), p90: pctile(exS, 90) }, gpt: { avg: r1(avg(exG)), p90: pctile(exG, 90) } },
    tokens: { sp4: Math.round(avg(nums(eboth.map((s) => es[s].usage?.total_tokens)))) },
  };

  /* ---------- 3. 리스크 검토 ---------- */
  const rs = loadReview("sp4");
  const rg = loadReview("gpt");
  const cl = allChecklists();
  const rboth = shas.filter((s) => rs[s]?.status === "completed" && rg[s]?.status === "completed" && rs[s].result && rg[s].result && rs[s].bucket === rg[s].bucket);
  const fin = (r: (typeof rs)[string]) => finalizeReview(r.result!, cl[r.bucket] ?? []);
  let itemPairs = 0;
  let findingAgree = 0;
  let decisionAgree = 0;
  let verdictAgree = 0;
  const cnt = { sp4: { risk: 0, lawyer: 0, note: 0, ok: 0 }, gpt: { risk: 0, lawyer: 0, note: 0, ok: 0 } };
  const verdicts = { sp4: {} as Record<string, number>, gpt: {} as Record<string, number> };
  const contradictions = { sp4: 0, gpt: 0 };
  const missingItems = { sp4: 0, gpt: 0 };
  for (const s of rboth) {
    const a = fin(rs[s]);
    const b = fin(rg[s]);
    const va = verdictOf(a.items, a.is_high_value);
    const vb = verdictOf(b.items, b.is_high_value);
    verdicts.sp4[va] = (verdicts.sp4[va] ?? 0) + 1;
    verdicts.gpt[vb] = (verdicts.gpt[vb] ?? 0) + 1;
    if (va === vb) verdictAgree++;
    for (const [m, r] of [
      ["sp4", a],
      ["gpt", b],
    ] as const) {
      const c = countItems(r.items);
      cnt[m].risk += c.risk;
      cnt[m].lawyer += c.lawyer;
      cnt[m].note += c.note;
      cnt[m].ok += c.ok;
      contradictions[m] += r.items.filter((i) => i.why.startsWith("AI 답이 서로 어긋나")).length;
      missingItems[m] += r.items.filter((i) => i.why.startsWith("AI가 이 항목을 답하지")).length;
    }
    const bi = new Map(b.items.filter((i) => i.item_id.startsWith("C")).map((i) => [i.item_id, i]));
    for (const i of a.items.filter((x) => x.item_id.startsWith("C"))) {
      const j = bi.get(i.item_id);
      if (!j) continue;
      itemPairs++;
      if (i.finding === j.finding) findingAgree++;
      if (i.decision === j.decision) decisionAgree++;
    }
  }
  const allS = shas.filter((s) => rs[s]?.status === "completed" && rs[s].result);
  const rv = (m: typeof rs, list: string[]) => nums(list.map((s) => secOf(m[s].timing, "instruct")));
  out.review = {
    pairedContracts: rboth.length,
    sp4Total: allS.length,
    failed: {
      sp4: Object.values(rs).filter((r) => r.status === "failed").length,
      gpt: Object.values(rg).filter((r) => r.status === "failed").length,
    },
    verdictAgreement: pc(verdictAgree, rboth.length),
    verdicts,
    itemFindingAgreement: pc(findingAgree, itemPairs),
    itemDecisionAgreement: pc(decisionAgree, itemPairs),
    decisionsPerContract: {
      sp4: Object.fromEntries(Object.entries(cnt.sp4).map(([k, v]) => [k, r1(v / Math.max(rboth.length, 1))])),
      gpt: Object.fromEntries(Object.entries(cnt.gpt).map(([k, v]) => [k, r1(v / Math.max(rboth.length, 1))])),
    },
    contradictions,
    missingItems,
    seconds: {
      sp4: { avg: r1(avg(rv(rs, rboth))), p90: pctile(rv(rs, rboth), 90) },
      gpt: { avg: r1(avg(rv(rg, rboth))), p90: pctile(rv(rg, rboth), 90) },
      sp4All: { avg: r1(avg(rv(rs, allS))), p90: pctile(rv(rs, allS), 90) },
    },
    tokens: {
      sp4: Math.round(avg(nums(rboth.map((s) => rs[s].usage?.total_tokens)))),
      gpt: Math.round(avg(nums(rboth.map((s) => rg[s].usage?.total_tokens)))),
    },
    reasoning: { sp4: "reasoning_effort=high", gpt: "Studio 기본" },
  };
  writeJson("v2/analysis/compare.json", out);
  console.log(JSON.stringify(out, (k, v) => (k === "disagreements" || k === "allFields" ? `(${(v as unknown[]).length}건)` : v), 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
