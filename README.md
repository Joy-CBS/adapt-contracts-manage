# 어댑트 계약서 검토 자동화 PoC

Upstage Studio(Document Agent API v2)를 최대한 활용해 어댑트(파이노버스랩)의 계약서를
표준계약서 유형별로 분류하고, 신규 검토 요청에 대해 리스크와 수정 의견을 **Word 변경기록**으로
제공하는 PoC입니다.

- 처리 흐름과 Studio/자체 로직 구분: [docs/architecture.md](docs/architecture.md)
- Studio API 정본: `UpstageAI/studio-pipeline`의 `docs/public`, `skills/document-agent-api`

## 기술 구성

| 영역 | 선택 | 비고 |
|---|---|---|
| 웹·API | Next.js 15 (App Router, TypeScript) | Vercel 배포 |
| 문서 AI | Upstage Studio API `https://api.upstage.ai/v2` | 키는 서버에서만 사용 |
| DB | Postgres (Neon) + Drizzle ORM | 카테고리·표준안 레지스트리, Studio ID 연결 |
| 파일 | Vercel Blob | 생성된 .docx, Slack 첨부 원본 |
| 접근 제어 | `DEMO_PASSWORD` Basic Auth | 외부 공유 데모 보호 |

## 시작하기

```bash
npm install
cp .env.example .env      # 값 채우기
npm run studio:check      # Studio 키·Project 연결 확인
npm run db:generate && npm run db:migrate   # DB 테이블 생성
npm run dev
```

## 폴더 구조

```
src/
  app/                 화면(개요·카테고리 맵·계약서 목록) 및 API 라우트
  db/                  Drizzle 스키마와 연결
  lib/studio/          Studio API 클라이언트·타입
  middleware.ts        데모 비밀번호 보호
studio/                Studio Workflow Config 정의(JSON, 버전 관리)
scripts/               점검·일괄 적재 등 로컬 실행 스크립트
docs/                  설계 문서
```

## 작업 단위

| 단계 | 내용 | 상태 |
|---|---|---|
| F0 | 프로젝트 셋업 | 완료 |
| F1 | 기존 계약서 일괄 적재 (Parse·Extract → Collection) | 예정 |
| F2 | 카테고리 체계·표준안 후보·커버리지 분석 | 예정 |
| F4 | 표준안 대비 리스크 분석 | 예정 |
| F5 | 표준양식 변환 + Word 변경기록 | 예정 |
| F7 | 웹 대시보드·배포 | 예정 |
| F3, F6 | 신규 유형 판단·생성, Slack 연동 | 이후 |

## 데이터 취급

원본 계약서에는 주민등록번호·연락처 등 개인정보가 포함되어 있습니다.

- 원본 계약서와 추출 결과는 저장소에 커밋하지 않습니다(`.gitignore`).
- 추출 스키마에 주민번호·연락처 필드를 두지 않고, 화면 노출 텍스트는 마스킹합니다.
- 외부 공유 배포에는 반드시 `DEMO_PASSWORD`를 설정합니다.
