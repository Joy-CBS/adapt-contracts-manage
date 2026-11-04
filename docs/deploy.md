# Vercel 배포

## 1. 프로젝트 가져오기

1. vercel.com → **Sign Up → Continue with GitHub** (Joy-CBS 계정)
2. **Add New… → Project** → `adapt-contracts-manage` 옆 **Import**
3. 설정은 그대로 두고 **Deploy** (첫 배포는 DB가 없어 화면이 오류를 낼 수 있습니다. 다음 단계 후 다시 배포합니다.)

## 2. DB 연결 (Neon)

1. 프로젝트 화면 상단 **Storage → Create Database → Neon (Postgres)** → **Connect**
2. 연결하면 `DATABASE_URL`이 프로젝트 환경 변수에 자동으로 들어갑니다.
3. **Settings → Environment Variables**에서 `DATABASE_URL` 값을 복사해 로컬 `.env`에 붙여 넣고:

```bash
npm run db:seed     # 테이블 생성 + 분석 결과 적재 (data/ 폴더 기준)
```

## 3. 환경 변수

**Settings → Environment Variables**에 추가:

| 이름 | 값 |
|---|---|
| `UPSTAGE_API_KEY` | Studio API 키 |
| `UPSTAGE_PROJECT_ID` | (선택) Studio PoC 프로젝트 ID |
| `DEMO_PASSWORD` | 데모 접속 비밀번호 (외부 공유 시 필수) |

## 4. 재배포

**Deployments → 최신 항목 ⋯ → Redeploy**. 접속하면 브라우저가 아이디/비밀번호를 묻습니다.
아이디는 아무 값, 비밀번호는 `DEMO_PASSWORD`입니다.

> Vercel Hobby(무료) 플랜은 약관상 비상업 용도입니다. 회사 업무로 계속 쓰려면 Pro 팀 계정을 확인하세요.
