/** 검토 결과 요약 확인용: npx tsx scripts/v2-review-peek.ts */
import { loadReview } from "./v2-review";
import { allChecklists } from "./lib/checklist";
import { countItems, finalizeReview, verdictOf } from "@/lib/review-types";

const cl = allChecklists();
for (const m of ["sp4", "gpt"] as const) {
  const s = loadReview(m);
  for (const v of Object.values(s)) {
    if (v.status !== "completed" || !v.result) {
      console.log(m, v.bucket, v.status, v.error ?? "");
      continue;
    }
    const r = finalizeReview(v.result, cl[v.bucket]);
    const c = countItems(r.items);
    const raw = v.result.items;
    const f = (x: (i: (typeof raw)[number]) => boolean) => raw.filter(x).length;
    console.log(
      m,
      v.bucket.padEnd(12),
      "studio",
      v.verdict,
      "app",
      verdictOf(r.items, r.is_high_value),
      JSON.stringify(c),
      `raw ${raw.length}/${cl[v.bucket].length} 일탈 ${f((i) => i.finding === "일탈")} 누락 ${f((i) => i.finding === "누락")} 일치 ${f((i) => i.finding === "일치")} 위반 ${f((i) => i.violates_confirmed)} 알림 ${f((i) => i.matched_alert)} 불확실 ${f((i) => i.uncertain)} 추가 ${(v.result.extra_clauses ?? []).length}`,
      (v.timing ?? []).map((t) => t.seconds).join("/"),
    );
  }
}
