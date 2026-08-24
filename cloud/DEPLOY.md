# 배포 가이드 — Cloudflare Pages + Supabase (전부 무료 티어)

## 구성

```
브라우저 ──HTTPS──> Cloudflare Pages (정적 파일 + Functions)
                          │  service_role 키는 여기에만 존재
                          └──REST──> Supabase Postgres
```

브라우저에는 **Supabase 키가 일절 내려가지 않는다.** 모든 DB 접근은 Cloudflare Worker가
service_role 키로 대신 수행하고, 두 테이블은 RLS를 켜되 정책을 하나도 만들지 않아
anon 키로는 아무것도 읽거나 쓸 수 없다.

엑셀 생성은 Workers에서 exceljs가 동작하지 않으므로(Node 스트림 의존) 관리자
브라우저에서 처리한다. 결과물과 `설문명_유형_날짜.xlsx` 파일명 규칙은 로컬판과 동일하다.

## 무료 티어 한도

| | 한도 | 이 설문 시스템 기준 |
|---|---|---|
| Cloudflare Pages | 요청 무제한, Functions 10만 호출/일 | 응답 1건당 약 4~5 호출. 하루 수천 명도 여유 |
| Supabase | DB 500MB, 월 5GB 전송 | 응답 1건 수 KB. 사실상 제한 없음 |

Supabase 무료 프로젝트는 **7일간 아무 요청이 없으면 일시정지**된다. 교육 회차 사이에
공백이 길면 설문 시작 전 관리자 화면에 한 번 접속해 깨워두면 된다.

---

## 1단계 — Supabase 프로젝트 생성 (직접 하셔야 합니다)

1. https://supabase.com 가입 → **New project**
2. Region은 `Northeast Asia (Seoul)` 선택
3. 데이터베이스 비밀번호는 아무거나 (이후 쓸 일 없음)
4. 프로젝트가 만들어지면 **SQL Editor** 에서 `schema.sql` 전체를 붙여넣고 실행
5. **Project Settings → API** 에서 아래 두 값을 복사
   - `Project URL` (예: `https://abcdefgh.supabase.co`)
   - `service_role` 키 — `anon` 키가 아니라 **service_role** 이다

## 2단계 — Cloudflare 계정 및 API 토큰 (직접 하셔야 합니다)

1. https://dash.cloudflare.com 가입
2. 우측 상단 프로필 → **My Profile → API Tokens → Create Token**
3. **Custom token** 선택 후 권한을 이렇게 준다
   - `Account` · `Cloudflare Pages` · **Edit**
4. 생성된 토큰과, 대시보드 우측에 표시되는 **Account ID** 를 복사

## 3단계 — 자격증명 전달

레포 루트에 `.env.deploy` 파일을 만들고 아래를 채운다.
(이 파일은 `.gitignore` 에 들어 있어 커밋되지 않는다. **채팅창에 붙여넣지 말 것.**)

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
ADMIN_PASSWORD=원하는관리자비밀번호
AUTH_SECRET=아무_긴_랜덤_문자열
```

`AUTH_SECRET` 은 아래 명령으로 만들면 된다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4단계 — 배포

```bash
npm install
npx wrangler pages project create fki-survey --production-branch main
npx wrangler pages deploy public --project-name fki-survey
```

환경변수는 Pages 대시보드 → 프로젝트 → **Settings → Environment variables → Production** 에
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ADMIN_PASSWORD` / `AUTH_SECRET` 네 개를
**Encrypt** 체크해서 등록한다. 등록 후 한 번 더 배포해야 반영된다.

CLI로도 넣을 수 있다.

```bash
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name fki-survey
```

## 5단계 — 초기 설문 만들기

배포된 주소 `/admin` 으로 접속해 로그인한 뒤 좌측의 **＋ A형 새 설문** / **＋ B형 새 설문**
을 한 번씩 누르면 기본 문항이 들어간 설문이 생성된다. 이후 제목과 문항을 회차에 맞게 고친다.

## 배포 후 점검

- [ ] 응답 화면에서 A형·B형 각각 1건 제출해 보기
- [ ] 관리자에서 엑셀 다운로드 → 파일명이 `설문명_유형_날짜.xlsx` 인지 확인
- [ ] 관리자 비밀번호가 `fki2026` 이 아닌지 확인
- [ ] 휴대폰에서 실제로 열어보기
- [ ] A형처럼 이름을 받는 설문은 개인정보 수집·이용 동의 문구를 안내문에 넣기

## 커스텀 도메인

Pages → **Custom domains** 에서 도메인을 붙일 수 있다. 무료이고 SSL도 자동이다.
