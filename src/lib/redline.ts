import JSZip from "jszip";
import type { ClauseReview, ReviewResult, StandardTemplate } from "@/lib/contracts";

/**
 * F5 표준양식 변환 + Word 변경기록(.docx) 생성.
 * - 문서 뼈대는 해당 유형 표준안의 조항 순서를 따른다(표준양식 변환).
 * - 계약서 원문 중 가드레일을 벗어난 부분은 "삭제"로, 수정 제안은 "삽입"으로 기록하고(변경 추적),
 *   리스크 사유는 메모(댓글)로 단다. Word에서 변경 내용 수락/거부로 바로 처리할 수 있다.
 */

const AUTHOR = "Upstage 계약 검토";
const SEVERITY_KO: Record<string, string> = { high: "높음", medium: "중간", low: "낮음", none: "없음" };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Ctx = { revId: number; commentId: number; comments: string[]; date: string };

const lines = (s: string) => s.replace(/\r/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);

function run(text: string, opts: { bold?: boolean; size?: number; deleted?: boolean } = {}) {
  const rPr = [opts.bold ? "<w:b/>" : "", opts.size ? `<w:sz w:val="${opts.size}"/>` : ""].join("");
  const tag = opts.deleted ? "w:delText" : "w:t";
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<${tag} xml:space="preserve">${esc(text)}</${tag}></w:r>`;
}

function para(inner: string, style?: string) {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;
}

function ins(ctx: Ctx, inner: string) {
  return `<w:ins w:id="${ctx.revId++}" w:author="${AUTHOR}" w:date="${ctx.date}">${inner}</w:ins>`;
}

function del(ctx: Ctx, inner: string) {
  return `<w:del w:id="${ctx.revId++}" w:author="${AUTHOR}" w:date="${ctx.date}">${inner}</w:del>`;
}

function addComment(ctx: Ctx, text: string) {
  const id = ctx.commentId++;
  const body = lines(text)
    .map((l) => `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${run(l)}</w:p>`)
    .join("");
  ctx.comments.push(`<w:comment w:id="${id}" w:author="${AUTHOR}" w:date="${ctx.date}" w:initials="UP">${body}</w:comment>`);
  return id;
}

/** 여러 문단에 걸친 영역에 메모를 단다 */
function withComment(id: number, paragraphs: string[]) {
  if (!paragraphs.length) return paragraphs;
  const out = [...paragraphs];
  out[0] = out[0].replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/, (m) => `${m}<w:commentRangeStart w:id="${id}"/>`);
  const last = out.length - 1;
  out[last] = out[last].replace(
    /<\/w:p>$/,
    `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r></w:p>`,
  );
  return out;
}

function commentText(r: ClauseReview, guardrail?: string) {
  const head = `[리스크 ${SEVERITY_KO[r.severity] ?? r.severity}] ${r.status}`;
  return [head, r.issue, guardrail ? `가드레일: ${guardrail}` : "", r.suggestion_ko && r.suggestion_ko !== r.suggestion ? `제안(국문): ${r.suggestion_ko}` : ""]
    .filter(Boolean)
    .join("\n");
}

export type RedlineInput = {
  template: StandardTemplate;
  categoryName: string;
  review: ReviewResult;
  verdict?: string;
  contractFilename: string;
  contractLanguage?: string;
  /** F1 추출 메타데이터: 전문의 [상대방]·[브랜드] 등 자리표시자를 채운다 */
  placeholders?: Record<string, unknown>;
  reviewedAt?: Date;
};

function fillPlaceholders(text: string, meta: Record<string, unknown> = {}) {
  const val = (k: string) => {
    const v = meta[k];
    return Array.isArray(v) ? v.join(", ") : v ? String(v) : "";
  };
  const map: Array<[RegExp, string]> = [
    [/\[(상대방|Partner|Counterparty|Creator|Influencer)[^\]]*\]/gi, val("counterparty_name")],
    [/\[(브랜드|Brand)[^\]]*\]/gi, val("brands")],
    [/\[(지역|국가|Territory)[^\]]*\]/gi, val("territory")],
  ];
  return map.reduce((t, [re, v]) => (v ? t.replace(re, v) : t), text);
}

export function isEnglish(lang?: string) {
  return lang === "en";
}

export async function buildRedlineDocx(input: RedlineInput): Promise<Buffer> {
  const { template: tpl, review } = input;
  const en = isEnglish(input.contractLanguage);
  const ctx: Ctx = { revId: 1, commentId: 0, comments: [], date: (input.reviewedAt ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z") };
  const body: string[] = [];

  // 제목 + 검토 요약 메모
  const counts = review.clause_reviews.reduce<Record<string, number>>((a, r) => ((a[r.severity] = (a[r.severity] ?? 0) + 1), a), {});
  const summaryId = addComment(
    ctx,
    [
      `검토 요약 (${input.categoryName}${tpl.status === "draft" ? ", 표준안 초안 기준" : ""})`,
      `판정: ${input.verdict ?? "-"} / 리스크 높음 ${counts.high ?? 0} · 중간 ${counts.medium ?? 0} · 낮음 ${counts.low ?? 0}${review.is_high_value ? " / 1억 원 이상 고액 계약" : ""}`,
      review.summary,
      review.overall_opinion,
    ].join("\n"),
  );
  body.push(...withComment(summaryId, [para(run(en ? tpl.title_en : tpl.title_ko), "Title")]));
  body.push(para(run(`${en ? "Source contract" : "원 계약서"}: ${input.contractFilename}`, { size: 18 }), "Subtle"));
  for (const l of lines(fillPlaceholders(en ? tpl.preamble_en : tpl.preamble_ko, input.placeholders))) body.push(para(run(l)));

  const byNo = new Map<number, ClauseReview>();
  for (const r of review.clause_reviews) if (r.standard_clause_no > 0 && !byNo.has(r.standard_clause_no)) byNo.set(r.standard_clause_no, r);

  for (const c of tpl.clauses) {
    const r = byNo.get(c.no);
    const heading = en ? `Article ${c.no} (${c.title_en})` : `제${c.no}조 (${c.title_ko})`;
    body.push(para(run(heading, { bold: true }), "Heading2"));
    const standardText = en ? c.text_en : c.text_ko;

    if (!r || r.status === "일치") {
      // 일치: 계약서의 실제 문구를 표준 위치에 옮긴다(없으면 표준 문구)
      const text = r?.contract_excerpt?.trim() || standardText;
      for (const l of lines(text)) body.push(para(run(l)));
      continue;
    }
    const cid = addComment(ctx, commentText(r, c.guardrail));
    const ps: string[] = [];
    if (r.status === "누락") {
      const text = r.suggestion?.trim() || standardText;
      for (const l of lines(text)) ps.push(para(ins(ctx, run(l))));
    } else {
      // 일탈: 원문 삭제 + 제안 삽입
      for (const l of lines(r.contract_excerpt || "")) ps.push(para(del(ctx, run(l, { deleted: true }))));
      for (const l of lines(r.suggestion || standardText)) ps.push(para(ins(ctx, run(l))));
    }
    body.push(...withComment(cid, ps.length ? ps : [para(run(standardText))]));
  }

  // 표준안에 없는 계약서 고유 조항
  const extras = review.clause_reviews.filter((r) => r.standard_clause_no === 0 || r.status === "추가조항");
  if (extras.length) {
    body.push(para(run(en ? "Additional provisions in the source contract" : "계약서 고유 조항", { bold: true }), "Heading2"));
    for (const r of extras) {
      const cid = addComment(ctx, commentText(r));
      const ps: string[] = [];
      if (r.standard_clause_title) ps.push(para(run(r.standard_clause_title, { bold: true })));
      const risky = r.severity === "high" || r.severity === "medium";
      for (const l of lines(r.contract_excerpt || "")) ps.push(para(risky ? del(ctx, run(l, { deleted: true })) : run(l)));
      if (risky && r.suggestion) for (const l of lines(r.suggestion)) ps.push(para(ins(ctx, run(l))));
      body.push(...withComment(cid, ps.length ? ps : [para(run("-"))]));
    }
  }

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W}>${ctx.comments.join("")}</w:comments>`;
  const font = `<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtle"><w:name w:val="Subtle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:color w:val="808080"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`,
  );
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W}><w:trackRevisions/></w:settings>`,
  );
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/comments.xml", commentsXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
