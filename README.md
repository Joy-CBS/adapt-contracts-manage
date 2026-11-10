# 어댑트 계약서 검토 자동화 PoC

Upstage Studio(Document Agent API v2)를 최대한 활용해 어댑트(파이노버스랩)의 계약서를
표준계약서 유형별로 분류하고, 표준안 대비 리스크와 수정 의견을 **Word 변경기록**으로
제공하는 PoC입니다.

- 처리 흐름과 Studio/자체 로직 구분: [docs/architecture.md](docs/architecture.md)
- Vercel 배포 절차: [docs/deploy.md](docs/deploy.md)
- Studio API 정본: `UpstageAI/studio-pipeline`의 `docs/public`, `skills/document-agent-api`

## 기술 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 웹·API | Next.js 15 (App Router, TypeScript) | Vercel 배포 |
| 문서 AI | Upstage Studio API `https://api.upstage.ai/v2` | 키는 서버에서만 사용 |
| DB | Postgres + Drizzle ORM | 배포: Neon(`DATABASE_URL`), 로컬: 내장 PGlite(`data/pglite`) |
| Word 변경기록 | 어댑트 표준 원본 .docx에 변경 추적·메모(`src/lib/redline-v2.ts`) | 다운로드 시 즉석 생성 |
| 글꼴 | Pretendard(가변, 동적 서브셋) | `pretendard` 패키지 |
| 접근 제어 | 로그인 화면 + 서명 쿠키(`DEMO_USER`/`DEMO_PASSWORD`) | 외부 공유 데모 보호, 30일 유지 |

## Studio 리소스 (v2, 추론 모델 solar-pro4)

| Agent | Workflow | 용도 |
|---|---|---|
| 어댑트 계약서 적재 (F1) | Parse → Extract(26개 필드, solar-pro4) → Export(Collection) | 계약서 적재 |
| 어댑트 계약서 유형 판단 v2 | Parse → Classify(상위 5종 + 기타) → Rationale(Instruct, 49종 근거) | 유형 판단 + 분류 근거 |
| 어댑트 계약서 리스크 검토 v2 | Parse → Instruct(유형별 플레이북 고정) → Validate | 항목별 사실 → 수정 필요/변호사 확인/참고 |

같은 Workflow를 GPT(Studio 기본 모델)로도 만들어 성능을 비교했다(`scripts/v2-compare.ts`).

## 실행 순서 (v2)

```bash
npm install
cp .env.example .env                      # UPSTAGE_API_KEY 등
# 어댑트 전달자료를 data/adapt/{spec,kb,standards}에 둔다(저장소에 넣지 않음)
npx tsx scripts/v2-classify.ts setup      # 유형 판단 Agent·Config(sp4, gpt)
npx tsx scripts/v2-classify.ts submit sp4 && npx tsx scripts/v2-classify.ts collect sp4
npx tsx scripts/v2-extract.ts setup && npx tsx scripts/v2-extract.ts submit && npx tsx scripts/v2-extract.ts collect
npx tsx scripts/v2-review.ts setup        # 리스크 검토 Agent·유형별 Config
npx tsx scripts/v2-review.ts submit sp4 && npx tsx scripts/v2-review.ts collect sp4
npx tsx scripts/v2-compare.ts             # GPT vs SP4 비교 지표(data/v2/analysis)
npm run db:seed                           # DB 적재 + data/seed-bundle.json.gz 생성
npm run dev
```

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 검토 담당자 할 일: 분류 확인 → 변호사 확인 요청 → 수정본 보내기 → 답변 기록 순서와 바로가기 |
| `/classify` | AI 분류 확인: 근거 수준별 목록, i 버튼(분류 근거), 승인·다른 유형으로·기타로, 근거 충분 일괄 승인 |
| `/lawyer` | 변호사 확인 항목: 요청 전·답변 대기·답변 완료, 질문 목록 복사, 답변 기록 |
| `/contracts` | 계약서 목록: 판정·유형·분류 상태 필터 |
| `/contracts/[id]` | 항목별 판단 이유·근거·변호사 질문, 분류 확인, 표준양식 변경기록(.docx) |
| `/categories` | 검토 범위(상위 5종 + 기타)와 어댑트 표준 |
| `/categories/[key]` | 분류 기준, 표준 원문, 조항별 결과 분포, 기타의 세부 유형 |

## 작업 단위

| 단계 | 내용 | 상태 |
|---|---|---|
| F0 | 프로젝트 셋업 | 완료 |
| F1 | 기존 계약서 일괄 적재 (샘플 200건) | 완료 |
| F2 | 카테고리 체계(15개)·유형 판단 Agent·임시 표준안·커버리지 | 완료 |
| F4 | 표준안 대비 리스크 분석 (Studio Instruct + Validate) | 완료 |
| F5 | 표준양식 변환 + Word 변경기록(삭제/삽입 + 메모) | 완료 |
| F7 | 웹 대시보드 | 완료 · Vercel 배포 대기 |
| F3 | 신규 계약서 유형 판단 → 신규 유형 생성 → 리스크 분석 | 다음 |
| F6 | Slack 인입·회신 | 다음 |

## 데이터 취급

원본 계약서에는 주민등록번호·연락처 등 개인정보가 포함되어 있습니다.

- 원본 계약서와 분석 결과(`data/`)는 저장소에 커밋하지 않습니다(`.gitignore`).
- 추출 스키마에 주민번호·연락처 필드를 두지 않고, 리스크 검토 발췌에서도 `[개인정보]`로 가리도록 지시합니다.
- 외부 공유 배포에는 반드시 `DEMO_PASSWORD`를 설정합니다. 비밀번호는 환경 변수로만 두고 코드·저장소에 넣지 않습니다.
