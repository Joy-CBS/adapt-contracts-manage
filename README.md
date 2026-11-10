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

## Studio 리소스 (v3)

| Agent | Workflow | 모델 |
|---|---|---|
| 정보 추출 | Parse → Extract(26개 필드) | solar-pro4 |
| 유형 판단 | Parse → Classify(어댑트 분류체계 49종) → Rationale(Instruct: 1·2순위, 근거 신호·발췌) | solar-pro4 |
| 리스크 검토 | Parse → Instruct(유형별 플레이북 고정) → Validate. 표준 25종 + 대만(참고) + 공통 기준, Config 27개 | GPT(Studio 기본) |

리스크 검토만 GPT로 둔 이유: solar-pro4는 결론이 소극적이고 3.5배 느렸다(비교 결과는 Notion 문서).

## 실행 순서 (v3)

```bash
npx tsx scripts/v3-classify.ts setup && npx tsx scripts/v3-classify.ts submit && npx tsx scripts/v3-classify.ts collect
npx tsx scripts/v3-review.ts setup && npx tsx scripts/v3-review.ts submit && npx tsx scripts/v3-review.ts collect
npx tsx scripts/v3-requests.ts submit <dir>   # 검토 요청 샘플(기존에 없는 계약서)
npm run db:seed                                # DB 적재 + data/seed-bundle.json.gz
```

## 화면

| 경로 | 내용 |
|---|---|
| `/` 검토 요청 | 내가 처리할 차례 / 기다리는 중 / 완료. 카드마다 지금 할 일과 버튼 하나 |
| `/requests/new` | 계약서 올리기(배포 서버가 Studio Job 시작) |
| `/requests/[id]` | 단계(접수 → 유형 확인 → 리스크 검토 → 변호사 확인 → 완료)와 "지금 할 일" 패널, 항목별 검토 결과 |
| `/archive` 계약서 보관함 | 기존 계약서를 유형별로 조회, 분류 근거가 약한 건만 확인 요청 |
| `/standards` 표준계약서 | 표준 25종·표준 없는 유형, 플레이북 조항별 기존 계약 현황, 원본 docx |

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
