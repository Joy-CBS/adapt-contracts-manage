/**
 * F1 결과 요약: 추출 결과를 CSV로 모으고 분포·실패·누락 항목을 출력한다.
 *   npm run f1:report
 * 출력: data/f1/contracts.csv, data/f1/summary.json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { dataDir, loadState } from "@/lib/state";

const FIELDS = [
  "contract_title", "contract_type", "language", "signed_date", "adapt_entity", "adapt_role",
  "counterparty_type", "brands", "channels", "territory", "scope_summary", "deliverables", "term",
  "secondary_use_period", "amount", "currency", "payment_terms", "ip_ownership", "portrait_rights",
  "exclusivity", "confidentiality", "penalty_damages", "termination", "governing_law_dispute", "notable_terms",
];

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("; ") : v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function count(values: string[]) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v || "(빈 값)", (m.get(v || "(빈 값)") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function main() {
  const state = loadState();
  const recs = Object.values(state.contracts);
  const dir = path.join(dataDir(), "f1");
  const rows: Array<Record<string, unknown>> = [];
  for (const r of recs) {
    const f = path.join(dir, "extract", `${r.sha256}.json`);
    if (!fs.existsSync(f)) continue;
    const { value, jobId } = JSON.parse(fs.readFileSync(f, "utf8"));
    rows.push({ folder: r.folder, path: r.path, jobId, ...(value ?? {}) });
  }

  const header = ["folder", "path", "jobId", ...FIELDS];
  const csv = [header.join(","), ...rows.map((row) => header.map((h) => csvCell(row[h])).join(","))].join("\n");
  fs.writeFileSync(path.join(dir, "contracts.csv"), "﻿" + csv); // Excel 한글 깨짐 방지 BOM

  const missing = Object.fromEntries(
    FIELDS.map((k) => [k, rows.filter((r) => r[k] === undefined || r[k] === "" || (Array.isArray(r[k]) && !(r[k] as unknown[]).length)).length]),
  );
  const summary = {
    total: recs.length,
    completed: rows.length,
    failed: recs.filter((r) => r.status === "failed").map((r) => ({ path: r.path, error: r.error })),
    language: count(rows.map((r) => String(r.language ?? ""))),
    adapt_role: count(rows.map((r) => String(r.adapt_role ?? ""))),
    counterparty_type: count(rows.map((r) => String(r.counterparty_type ?? ""))),
    contract_type: count(rows.map((r) => String(r.contract_type ?? ""))),
    missing,
  };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, contract_type: summary.contract_type.slice(0, 40) }, null, 1));
}

main();
