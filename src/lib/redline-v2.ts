import JSZip from "jszip";
import { P_RE, paragraphText } from "@/lib/docx-std";
import { DECISION_LABEL, type ReviewItem, type ReviewV2, type StandardDocV2 } from "@/lib/review-types";

/**
 * 표준양식 변환 + Word 변경기록(.docx) v2.
 * 어댑트 표준계약서 원본(.docx)을 그대로 뼈대로 쓴다(서식·번호·서명란 유지).
 *  - 상대방 계약서가 표준과 다른 문단(일탈): 표준 문구를 "삭제", 상대방 문구를 "삽입"으로 변경 추적
 *    → Word에서 [모두 거부]하면 어댑트 표준 그대로, [수락]하면 상대방 조건이 반영된 문서가 된다
 *  - 수정 필요·변호사 확인 항목: 해당 문단에 메모(근거·수정 제안·변호사 질문)
 *  - 표준 문단에 대응하지 않는 항목(상대방 추가 조항 등): 문서 끝 "검토 의견" 부록에 정리
 * 표준이 없는 유형(대만 인플루언서·기타)은 검토 의견서(.docx)를 새로 만든다.
 */

const AUTHOR = "Upstage 계약 검토";
const SEV = { high: "🔴 필수", medium: "🟡 협상", low: "🟢 참고", none: "" } as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (s: string) => s.replace(/\r/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);

type Ctx = { rev: number; cid: number; comments: string[]; date: string };

export type ItemState = { status: "open" | "requested" | "answered"; resolution?: string | null; answerNote?: string | null };

export type RedlineV2Input = {
  standard: StandardDocV2 | null;
  categoryName: string;
  review: ReviewV2;
  verdict?: string | null;
  contractFilename: string;
  states?: Map<number, ItemState>;
  reviewedAt?: Date;
};

function run(text: string, opts: { bold?: boolean; deleted?: boolean; rPr?: string } = {}) {
  const rPr = opts.rPr ?? (opts.bold ? "<w:rPr><w:b/></w:rPr>" : "");
  const tag = opts.deleted ? "w:delText" : "w:t";
  return `<w:r>${rPr}<${tag} xml:space="preserve">${esc(text)}</${tag}></w:r>`;
}

function addComment(ctx: Ctx, text: string) {
  const id = ctx.cid++;
  const body = lines(text)
    .map((l) => `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${run(l)}</w:p>`)
    .join("");
  ctx.comments.push(`<w:comment w:id="${id}" w:author="${AUTHOR}" w:date="${ctx.date}" w:initials="UP">${body}</w:comment>`);
  return id;
}

function commentFor(it: ReviewItem, state?: ItemState) {
  const head = `[${DECISION_LABEL[it.decision]}${SEV[it.severity] ? ` · ${SEV[it.severity]}` : ""}] ${it.clause_ref}`;
  const out = [head, `판단 이유: ${it.why}`];
  if (it.finding === "누락") out.push("상대방 계약서에 이 조항이 없습니다.");
  if (it.issue) out.push(it.issue);
  if (it.basis) out.push(`근거 ${it.basis_tag}: ${it.basis}`);
  if (it.decision === "risk" && it.suggestion_ko) out.push(`수정 제안: ${it.suggestion_ko}`);
  if (it.decision === "risk" && it.suggestion && it.suggestion !== it.suggestion_ko) out.push(`Suggested wording: ${it.suggestion}`);
  if (it.decision === "needs_lawyer" && it.lawyer_question) out.push(`변호사 확인 질문: ${it.lawyer_question}`);
  if (state?.status === "requested") out.push("(변호사 확인 요청됨, 답변 대기)");
  if (state?.status === "answered") out.push(`변호사 답변: ${[state.resolution, state.answerNote].filter(Boolean).join(" — ")}`);
  return out.join("\n");
}

/** 문단 안의 run을 모두 "삭제"로 바꾼다(메모 참조 run 제외) */
function deleteRuns(ctx: Ctx, inner: string) {
  return inner.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (r) => {
    if (r.includes("<w:commentReference") || !/<w:t\b/.test(r)) return r;
    const d = r.replace(/<w:t(\s[^>]*)?>/g, (_m, a) => `<w:delText${a ?? ""}>`).replace(/<\/w:t>/g, "</w:delText>");
    return `<w:del w:id="${ctx.rev++}" w:author="${AUTHOR}" w:date="${ctx.date}">${d}</w:del>`;
  });
}

function firstRPr(pXml: string) {
  return pXml.match(/<w:r\b[^>]*>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? "";
}

function insertRun(ctx: Ctx, text: string, rPr = "") {
  return `<w:ins w:id="${ctx.rev++}" w:author="${AUTHOR}" w:date="${ctx.date}">${run(text, { rPr })}</w:ins>`;
}

/** 문단 xml에 메모 범위와 참조를 넣는다 */
function wrapComment(pXml: string, ids: number[]) {
  if (!ids.length) return pXml;
  const starts = ids.map((id) => `<w:commentRangeStart w:id="${id}"/>`).join("");
  const ends = ids
    .map((id) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`)
    .join("");
  let out = pXml;
  if (/<\/w:pPr>/.test(out)) out = out.replace(/<\/w:pPr>/, `</w:pPr>${starts}`);
  else out = out.replace(/^<w:p\b[^>]*>/, (m) => `${m}${starts}`);
  return out.replace(/<\/w:p>$/, `${ends}</w:p>`);
}

function plainPara(inner: string, style?: string) {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;
}

const ANNOTATE = (it: ReviewItem) => it.decision === "risk" || it.decision === "needs_lawyer";

function summaryText(input: RedlineV2Input) {
  const items = input.review.items;
  const n = (d: string) => items.filter((i) => i.decision === d).length;
  return [
    `검토 요약 · ${input.categoryName}${input.standard ? ` (어댑트 표준 ${input.standard.standardId} 기준)` : " (어댑트 표준 없음: 공통 기준 검토)"}`,
    `판정: ${input.verdict ?? "-"} / 수정 필요 ${n("risk")} · 변호사 확인 ${n("needs_lawyer")} · 참고 ${n("note")} · 기준 충족 ${n("ok")}`,
    input.review.summary,
    input.review.overall_opinion,
    input.standard ? "변경 내용 읽는 법: 삭제선 = 어댑트 표준 문구, 밑줄 = 상대방 계약서 문구. [모두 거부]하면 표준 그대로입니다." : "",
    `원 계약서: ${input.contractFilename}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function appendixParas(ctx: Ctx, items: Array<{ it: ReviewItem; i: number }>, states?: Map<number, ItemState>) {
  const ps: string[] = [plainPara(run("검토 의견 — 표준 문단에 대응하지 않는 항목", { bold: true }), "Heading2")];
  for (const { it, i } of items) {
    const cid = addComment(ctx, commentFor(it, states?.get(i)));
    ps.push(wrapComment(plainPara(run(it.clause_ref, { bold: true })), [cid]));
    if (it.contract_excerpt) {
      for (const l of lines(it.contract_excerpt)) ps.push(plainPara(it.finding === "추가조항" ? insertRun(ctx, l) : run(l)));
    }
    if (it.decision === "risk" && it.suggestion) ps.push(plainPara(run(`수정 제안: ${it.suggestion}`)));
  }
  return ps;
}

async function fromStandard(input: RedlineV2Input & { standard: StandardDocV2 }) {
  const ctx: Ctx = { rev: 9000, cid: 0, comments: [], date: (input.reviewedAt ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z") };
  const zip = await JSZip.loadAsync(Buffer.from(input.standard.docxBase64, "base64"));
  let xml = await zip.file("word/document.xml")!.async("string");
  // 표준 원본의 법무팀 작성용 메모는 걷어낸다(검토 메모와 섞이지 않게)
  xml = xml
    .replace(/<w:commentRangeStart\b[^>]*\/>/g, "")
    .replace(/<w:commentRangeEnd\b[^>]*\/>/g, "")
    .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>[\s\S]*?<\/w:r>/g, "");

  const byRef = new Map(input.standard.paragraphs.map((p) => [p.id, p.index]));
  const perPara = new Map<number, Array<{ it: ReviewItem; i: number }>>();
  const appendix: Array<{ it: ReviewItem; i: number }> = [];
  input.review.items.forEach((it, i) => {
    if (!ANNOTATE(it)) return;
    const idx = it.standard_ref ? byRef.get(it.standard_ref.trim()) : undefined;
    if (idx === undefined) appendix.push({ it, i });
    else perPara.set(idx, [...(perPara.get(idx) ?? []), { it, i }]);
  });

  let pi = 0;
  let firstText = true;
  const summaryId = addComment(ctx, summaryText(input));
  xml = xml.replace(P_RE, (p) => {
    const idx = pi++;
    let out = p;
    const ids: number[] = [];
    if (firstText && paragraphText(p)) {
      firstText = false;
      ids.push(summaryId);
    }
    const hits = perPara.get(idx);
    if (hits) {
      const dev = hits.find((h) => h.it.finding === "일탈" && h.it.contract_excerpt.trim());
      if (dev && !p.endsWith("/>")) {
        const rPr = firstRPr(p);
        const open = out.match(/^<w:p\b[^>]*>(<w:pPr>[\s\S]*?<\/w:pPr>)?/)?.[0] ?? "";
        const body = out.slice(open.length, -"</w:p>".length);
        out = `${open}${deleteRuns(ctx, body)}${insertRun(ctx, ` ${dev.it.contract_excerpt.trim()}`, rPr)}</w:p>`;
      }
      for (const h of hits) ids.push(addComment(ctx, commentFor(h.it, input.states?.get(h.i))));
    }
    if (ids.length && out.endsWith("/>")) out = out.replace(/\/>$/, "></w:p>");
    return wrapComment(out, ids);
  });
  if (appendix.length) xml = xml.replace(/(<w:sectPr\b[\s\S]*<\/w:sectPr>\s*<\/w:body>)/, `${appendixParas(ctx, appendix, input.states).join("")}$1`);
  zip.file("word/document.xml", xml);

  // 메모 파일 교체(원본의 확장 메모 파트는 제거해 id 불일치를 막는다)
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  zip.file("word/comments.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}>${ctx.comments.join("")}</w:comments>`);
  for (const f of ["word/commentsExtended.xml", "word/commentsIds.xml", "word/commentsExtensible.xml", "word/people.xml"]) zip.remove(f);
  let rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  rels = rels.replace(/<Relationship\b[^>]*Target="(?:commentsExtended|commentsIds|commentsExtensible|people)\.xml"[^>]*\/>/g, "");
  if (!/Target="comments\.xml"/.test(rels))
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="rIdUpstageComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
    );
  zip.file("word/_rels/document.xml.rels", rels);
  let ct = await zip.file("[Content_Types].xml")!.async("string");
  ct = ct.replace(/<Override\b[^>]*PartName="\/word\/(?:commentsExtended|commentsIds|commentsExtensible|people)\.xml"[^>]*\/>/g, "");
  if (!ct.includes('PartName="/word/comments.xml"'))
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
    );
  zip.file("[Content_Types].xml", ct);
  // 열면 변경 내용 추적이 켜져 있게
  const settings = zip.file("word/settings.xml");
  if (settings) {
    const s = await settings.async("string");
    if (!s.includes("<w:trackRevisions")) zip.file("word/settings.xml", s.replace(/(<w:settings\b[^>]*>)/, "$1<w:trackRevisions/>"));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** 표준이 없는 유형: 검토 의견서 */
async function memo(input: RedlineV2Input) {
  const ctx: Ctx = { rev: 1, cid: 0, comments: [], date: (input.reviewedAt ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z") };
  const body: string[] = [];
  const sid = addComment(ctx, summaryText(input));
  body.push(wrapComment(plainPara(run(`계약 검토 의견서 — ${input.categoryName}`), "Title"), [sid]));
  body.push(plainPara(run(`원 계약서: ${input.contractFilename} · 어댑트 표준계약서가 없는 유형이라 공통 기준(01_COMMON_POSITIONS)으로 검토했습니다.`), "Subtle"));
  const groups: Array<[string, ReviewItem["decision"]]> = [
    ["수정 필요(확정 기준 위반)", "risk"],
    ["변호사 확인 필요", "needs_lawyer"],
    ["참고", "note"],
  ];
  for (const [title, d] of groups) {
    const list = input.review.items.map((it, i) => ({ it, i })).filter((x) => x.it.decision === d);
    if (!list.length) continue;
    body.push(plainPara(run(`${title} (${list.length})`, { bold: true }), "Heading2"));
    for (const { it, i } of list) {
      const cid = addComment(ctx, commentFor(it, input.states?.get(i)));
      body.push(wrapComment(plainPara(run(it.clause_ref, { bold: true })), [cid]));
      for (const l of lines(it.contract_excerpt || "(계약서에 해당 조항 없음)")) body.push(plainPara(run(l)));
      if (d === "risk" && it.suggestion) body.push(plainPara(insertRun(ctx, it.suggestion)));
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const font = `<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtle"><w:name w:val="Subtle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="808080"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style></w:styles>`,
  );
  zip.file(
    "word/comments.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}>${ctx.comments.join("")}</w:comments>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildRedlineV2(input: RedlineV2Input): Promise<Buffer> {
  return input.standard ? fromStandard({ ...input, standard: input.standard }) : memo(input);
}
