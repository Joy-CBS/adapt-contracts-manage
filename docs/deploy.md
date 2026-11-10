# Vercel 배포

## 1. 프로젝트 가져오기

1. vercel.com → **Sign Up → Continue with GitHub** (Joy-CBS 계정)
2. **Add New… → Project** → `adapt-contracts-manage` 옆 **Import**
3. **Environment Variables**를 펼쳐 아래 두 개를 넣고 **Deploy**

| 이름 | 값 |
|---|---|
| `UPSTAGE_API_KEY` | Studio API 키 |
| `DEMO_USER` | 데모 접속 아이디 (없으면 `cb`) |
| `DEMO_PASSWORD` | 데모 접속 비밀번호 |

첫 배포는 DB가 없어 화면이 오류를 냅니다. 다음 단계에서 DB를 연결합니다.

## 2. DB 연결 (Neon)

1. 프로젝트 화면 상단 **Storage → Create Database → Neon (Serverless Postgres)** → 지역은 Seoul(icn1) 또는 Tokyo, 플랜 Free → **Create**
2. 프로젝트에 연결(Connect) → `DATABASE_URL`이 자동으로 환경 변수에 들어갑니다.
3. **Deployments → 최신 항목 ⋯ → Redeploy** (환경 변수 반영)

## 3. 분석 결과 올리기

1. `https://<프로젝트>.vercel.app/admin` 접속 → 로그인 화면에서 `DEMO_USER` / `DEMO_PASSWORD` 입력 (같은 브라우저에서 30일 유지)
2. 로컬 `data/seed-bundle.json.gz` 선택 → **업로드하고 적재** (테이블 생성 + 적재, 30초 내외)

분석을 다시 돌린 뒤에는 `npm run db:seed -- --bundle-only`로 묶음을 새로 만들어 같은 방법으로 올립니다.

> Vercel Hobby(무료) 플랜은 약관상 비상업 용도입니다. 회사 업무로 계속 쓰려면 Pro 팀 계정을 확인하세요.

## 접속 보호

- `DEMO_PASSWORD`가 있으면 모든 화면이 로그인 화면을 거칩니다. 한 번 로그인하면 같은 브라우저에서 30일 동안 다시 묻지 않습니다.
- 아이디·비밀번호를 바꾸려면 환경 변수를 수정하고 **Redeploy** 합니다. 바꾸면 기존 로그인은 모두 풀립니다.
- 프로그램에서 호출할 때는 `Authorization: Basic` 헤더(아이디:비밀번호)도 받습니다.
