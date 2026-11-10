import JSZip from "jszip";

/**
 * 어댑트 표준계약서 원본(.docx)을 문단 단위로 다룬다.
 * - 검토 Agent에는 문단마다 "S<번호>" 식별자를 붙인 본문을 주고, 검토 항목이 어느 표준 문단에 해당하는지 받는다.
 * - 변경기록(.docx)은 원본 문서 위에 그 문단을 찾아 변경 추적·메모를 단다(서식·번호 유지).
 * 문단 번호는 document.xml의 <w:p> 순서(표 안 문단 포함) 중 글자가 있는 문단만 센다.
 */

export type StdParagraph = { id: string; index: number; text: string };

const P_RE = /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g;

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function paragraphText(pXml: string) {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
  for (let m = re.exec(pXml); m; m = re.exec(pXml)) out += m[1] !== undefined ? unescapeXml(m[1]) : " ";
  return out.replace(/\s+/g, " ").trim();
}

/** 글자가 있는 문단 목록. index는 document.xml 안의 <w:p> 순번 */
export function stdParagraphs(documentXml: string): StdParagraph[] {
  const out: StdParagraph[] = [];
  let i = 0;
  let n = 0;
  for (const m of documentXml.matchAll(P_RE)) {
    const text = paragraphText(m[0]);
    if (text) out.push({ id: `S${++n}`, index: i, text });
    i++;
  }
  return out;
}

export async function readDocxXml(buf: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  return { zip, documentXml: await zip.file("word/document.xml")!.async("string") };
}

/** 검토 지시문에 넣을 표준 본문: "[S12] 문단" 형식 */
export function outlineForPrompt(ps: StdParagraph[]) {
  return ps.map((p) => `[${p.id}] ${p.text}`).join("\n");
}

export { P_RE };
