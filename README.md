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
| Word 변경기록 | 자체 OOXML 생성(`src/lib/redline.ts`) | 다운로드 시 즉석 생성, 별도 저장소 불필요 |
| 접근 제어 | `DEMO_PASSWORD` Basic Auth | 외부 공유 데모 보호 |

## Studio 리소스

| Agent | Workflow | 용도 |
|---|---|---|
| 어댑트 계약서 적재 (F1) | Parse → Extract(메타데이터 26개 필드) → Export(Collection) | 기존 계약서 적재 |
| 어댑트 계약서 유형 판단 (F2·F3) | Parse → Classify(15개 유형 + `new_type`) | 표준계약서 유형 판단 |
| 어댑트 계약서 리스크 검토 (F4) | Parse → Instruct(표준안·가드레일은 실행 요청으로 전달) → Validate | 조항별 리스크, red/yellow/green 판정 |

Config 정의는 `studio/*.json`에 있고, 생성된 ID는 `data/state.json`에 기록됩니다.

## 실행 순서

```bash
npm install
cp .env.example .env            # UPSTAGE_API_KEY 등 채우기
npm run studio:check            # Studio 연결 확인

npm run f1:setup                # 적재 Agent·Config 생성
npm run f1:ingest -- --submit-only   # 업로드·실행 요청
npm run f1:ingest               # 결과 수집 (data/f1)
npm run f1:report               # 분포·누락 요약, contracts.csv

npm run f2:taxonomy             # 유형 체계 초안 (data/f2/taxonomy.json)
npm run f2:classify -- setup    # 유형 판단 Agent 생성
npm run f2:classify -- submit && npm run f2:classify -- collect
npm run f2:templates            # 유형별 임시 표준안 (data/f2/templates)

npm run f4:review -- setup      # 리스크 검토 Agent 생성
npm run f4:review -- submit && npm run f4:review -- collect   # data/f4/reviews.json

npm run db:seed                 # 결과를 DB에 적재 (DATABASE_URL 없으면 로컬 PGlite)
npm run dev                     # http://localhost:3000
```

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 요약 지표, 처리 흐름, 많이 쓰이는 유형 |
| `/categories` | 카테고리 맵: 유형별 건수·표준안 상태·정형화 판단 |
| `/categories/[key]` | 유형 정의·포함/제외 기준, 표준안 조항(국·영문, 가드레일), 소속 계약서 |
| `/contracts` | 계약서 목록: 유형·판정·리스크 수 필터 |
| `/contracts/[id]` | 검토 의견, 조항별 원문 vs 수정 제안, 메타데이터, **Word 변경기록 다운로드** |

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
- 외부 공유 배포에는 반드시 `DEMO_PASSWORD`를 설정합니다.
