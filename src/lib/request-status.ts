/**
 * 검토 요청의 "지금 할 일"을 한 곳에서 정한다(목록 카드·상세 화면 공용).
 */

export type RequestLike = {
  stage: string | null;
  lawyer?: number | null;
  lawyerOpen?: number | null;
  lawyerRequested?: number | null;
  risk?: number | null;
};

export type NextAction = {
  /** 1 접수 · 2 유형 확인 · 3 리스크 검토 · 4 변호사 확인 · 5 완료 */
  step: 1 | 2 | 3 | 4 | 5;
  /** mine: 담당자 차례, waiting: AI·변호사를 기다리는 중, done: 끝 */
  owner: "mine" | "waiting" | "done" | "failed";
  title: string;
  hint: string;
  cta?: string;
};

export const STEPS = ["접수", "유형 확인", "리스크 검토", "변호사 확인", "완료"] as const;

export function nextAction(r: RequestLike): NextAction {
  const open = r.lawyerOpen ?? 0;
  const requested = r.lawyerRequested ?? 0;
  switch (r.stage) {
    case "analyzing":
      return { step: 1, owner: "waiting", title: "AI가 계약서를 읽고 있어요", hint: "유형 판단과 정보 추출이 끝나면 알려드려요. 보통 1분 안팎." };
    case "type_check":
      return { step: 2, owner: "mine", title: "유형을 확인해 주세요", hint: "AI가 제안한 유형이 맞는지 확인하면 그 유형의 플레이북으로 검토를 시작해요.", cta: "유형 확인하기" };
    case "reviewing":
      return { step: 3, owner: "waiting", title: "리스크를 검토하고 있어요", hint: "어댑트 플레이북 조항을 하나씩 대조하고 있어요. 보통 1~2분." };
    case "reviewed":
      if (open > 0)
        return {
          step: 4,
          owner: "mine",
          title: `변호사 확인 요청이 필요해요 · ${open}개 항목`,
          hint: "AI가 결론을 내리지 않은 항목이에요. 질문을 복사해 변호사에게 보내고 요청했다고 표시하세요.",
          cta: "결과 보고 요청하기",
        };
      if (requested > 0)
        return { step: 4, owner: "waiting", title: `변호사 답변을 기다리고 있어요 · ${requested}개 항목`, hint: "답변이 오면 항목마다 기록하세요.", cta: "답변 기록하기" };
      return { step: 5, owner: "mine", title: "검토를 마무리하세요", hint: "남은 확인 항목이 없어요. 수정본을 보내고 완료 처리하세요.", cta: "마무리하기" };
    case "done":
      return { step: 5, owner: "done", title: "검토 완료", hint: "" };
    case "failed":
      return { step: 1, owner: "failed", title: "처리하지 못했어요", hint: "파일을 다시 올려 주세요." };
    default:
      return { step: 1, owner: "waiting", title: "-", hint: "" };
  }
}
