# Safe Bike Seoul

서울의 따릉이 대여소, 자전거 경로, 자전거 교통사고 다발지역, 날씨 정보를 한 화면에서 비교하는 참고용 웹앱입니다.

> 이 앱은 경로의 **실제 안전성을 판단하거나 보장하지 않습니다.** 사고다발지역은 과거 통계이며, 현재 교통량·공사·노면·조명·시간대는 반영되지 않습니다.

## 사용하는 데이터

| 정보 | 출처 | API 경로 | 서버 캐시 |
|---|---|---|---|
| 출발지·목적지 검색 | 카카오 로컬 키워드 검색 (서울 범위) | `/api/places` | 1시간 |
| 따릉이 대여소 | 서울 열린데이터광장 공공자전거 실시간 대여정보 (`bikeList`) | `/api/stations` | 1분 |
| 자전거 경로 | 카카오맵 자전거 경로 조회 (`BIKE_ONLY`, `SHORTEST`) | `/api/bike-route` | 10분 |
| 사고다발지역 | 한국도로교통공단 자전거 교통사고 다발지역 (최신 연도 자동 확인) | `/api/accidents` | 1일 |
| 날씨 | 기상청 단기예보 (좌표 → 격자 변환) | `/api/forecast` | 30분 |

지도는 카카오맵 JavaScript SDK로 그립니다.

## 기술 스택

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript · Tailwind CSS 4

## 로컬 실행

Node.js 20.9 이상이 필요합니다.

```bash
npm install
cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
# .env에 인증키를 채운 뒤
npm run dev             # http://localhost:3000
```

```bash
npm run build           # 프로덕션 빌드 (끝나면 키 노출 검사 자동 실행)
npm start               # 프로덕션 서버
npm run lint
```

## 환경변수

`.env`는 `.gitignore`에 들어 있어 커밋되지 않습니다. 키 이름만 적힌 [`.env.example`](.env.example)을 참고하세요.

| 이름 | 필수 | 노출 범위 | 설명 |
|---|---|---|---|
| `KAKAO_REST_API_KEY` | ✅ | 서버 전용 | 카카오 REST API 키 (장소 검색, 자전거 경로) |
| `SEOUL_API_KEY` | ✅ | 서버 전용 | 서울 열린데이터광장 인증키 |
| `DATA_GO_KR_API_KEY` | ✅ | 서버 전용 | 공공데이터포털 일반 인증키 (Decoding 값 권장). 기상청 단기예보와 도로교통공단 사고다발지역 **활용신청이 각각 승인**되어 있어야 합니다. |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | ✅ | **브라우저에 포함됨** | 카카오 JavaScript 키 (지도 표시). 허용 도메인 등록으로 보호합니다. |
| `KAKAO_BIKE_ROUTE_DAILY_LIMIT` | 선택 | 서버 전용 | 서비스 전체 하루 자전거 경로 호출 한도 (기본 900, 공식 무료 1,000) |
| `KAKAO_LOCAL_DAILY_LIMIT` | 선택 | 서버 전용 | 서비스 전체 하루 장소 검색 호출 한도 (기본 90000, 공식 무료 100,000) |

- 서버 전용 키에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. 붙이면 브라우저 번들에 들어갑니다.
- 서버 키를 읽는 코드는 `src/lib/server/`에만 있고 `server-only`로 보호되어, 클라이언트 컴포넌트에서 가져오면 빌드가 실패합니다.
- `npm run build` 뒤에 `postbuild`로 [`scripts/check-client-secrets.mjs`](scripts/check-client-secrets.mjs)가 실행되어, 브라우저용 파일에 서버 키 값이 들어 있으면 빌드를 실패시킵니다.

## Vercel 배포

### 1. GitHub에 올리기

```bash
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

`.env`, `.next`, `node_modules`는 올라가지 않습니다. 저장소를 공개(public)로 만들어도 키는 포함되지 않지만, 처음에는 비공개(private)를 권장합니다.

### 2. Vercel 프로젝트 만들기

1. [vercel.com/new](https://vercel.com/new)에서 GitHub 저장소를 가져옵니다(Import).
2. Framework Preset은 **Next.js**로 자동 인식됩니다. 빌드 명령·출력 경로는 기본값 그대로 둡니다.
3. **Environment Variables**에 위 표의 필수 4개(필요하면 선택 2개)를 입력합니다.
   - 적용 환경: **Production**과 **Preview** 모두 체크하는 것을 권장합니다.
   - Vercel은 환경변수를 암호화해 저장합니다. 값은 `.env`에서 복사하되, `.env`의 다른 키(이 앱이 쓰지 않는 키)는 넣지 마세요.
4. **Deploy**를 누릅니다.

### 3. 주의할 점

- **환경변수를 바꾸면 반드시 다시 배포(Redeploy)** 해야 반영됩니다. Vercel은 이미 만들어진 배포에는 바뀐 값을 적용하지 않습니다. 특히 `NEXT_PUBLIC_KAKAO_JS_KEY`는 빌드할 때 코드에 박히므로 새 빌드가 꼭 필요합니다.
- 서버 함수 지역은 [`vercel.json`](vercel.json)에서 **서울(`icn1`)** 로 고정했습니다. 국내 공공 API와 가까워 응답이 빠릅니다.
- **캐시와 요청 횟수 제한은 서버 메모리에 저장**됩니다. Vercel은 요청이 많아지면 서버 인스턴스를 여러 개 띄우고, 한동안 요청이 없으면 내립니다. 그래서
  - 인스턴스마다 캐시가 따로라 외부 API 호출이 로컬보다 늘 수 있고,
  - 서비스 전체 하루 한도(`*_DAILY_LIMIT`)가 인스턴스마다 따로 셉니다.
  - 사용자가 늘면 Upstash Redis 같은 공용 저장소로 옮기는 것을 권장합니다. 그 전까지는 한도 값을 공식 한도보다 넉넉히 낮게 두세요.
- IP별 요청 제한은 Vercel이 넣어 주는 `x-forwarded-for` 헤더로 사용자를 구분합니다.

### 4. 카카오 허용 도메인 설정

카카오맵 JavaScript 키는 **등록된 도메인에서만** 동작합니다. 배포 주소를 등록하지 않으면 지도가 뜨지 않습니다.

[Kakao Developers](https://developers.kakao.com/console/app) → 내 애플리케이션 선택 → **[앱] > [플랫폼 키] > [JavaScript 키] > [JavaScript SDK 도메인]** 에 추가:

```
https://<프로젝트>.vercel.app        ← Vercel 기본 주소 (Production)
https://<내 도메인>                   ← 사용자 지정 도메인을 연결했다면
http://localhost:3000                 ← 로컬 개발
```

- **포트까지 정확히 일치해야 합니다.** `http://localhost:3000`만 등록하면 `http://localhost:3100`에서는 지도가 거부됩니다(카카오 응답: `domain mismatched! caller=http://localhost:3100`). 다른 포트로 실행한다면 그 주소도 등록하세요.
- 도메인은 앱당 **최대 10개**입니다. http와 https 중 하나만 등록해도 둘 다 허용됩니다.
- 등록하지 않은 주소에서는 지도 대신 안내 화면이 뜨고, 등록해야 할 정확한 주소가 표시됩니다.
- **Preview 배포 주소**(`<프로젝트>-<해시>-<팀>.vercel.app`)는 배포마다 바뀝니다. 와일드카드(`https://*.example.com`)는 비즈 앱에서만 쓸 수 있으므로, Preview에서 지도를 확인하려면 해당 주소를 직접 추가하거나 고정된 브랜치 주소(`<프로젝트>-git-<브랜치>-<팀>.vercel.app`)를 등록하세요.
- **[카카오맵] > [사용 설정]** 의 상태가 **ON**인지도 확인하세요. 꺼져 있으면 지도와 경로 API가 모두 실패합니다.
- **REST API 키**는 서버에서만 쓰므로 도메인 설정이 필요 없습니다. [플랫폼 키] > [REST API 키]의 **호출 허용 IP 주소**는 비워 두세요. Vercel 서버 IP는 고정되지 않아, IP를 등록하면 `-401 ip mismatched` 오류가 납니다.

### 5. 공공데이터 인증키

- 공공데이터포털·서울 열린데이터광장 키는 도메인 제한이 없습니다. 공공데이터포털에서 키에 **IP 제한**을 걸어 두었다면 해제하세요(사유 코드 32 오류).
- 배포 후 오류 메시지에 확인할 환경변수 이름이 함께 표시됩니다. 예: `등록되지 않은 인증키입니다. .env의 DATA_GO_KR_API_KEY를 확인하세요.`

### 6. 배포 후 확인

- 첫 화면에서 지도, 따릉이 대여소, 경로 비교, 사고다발지역, 날씨가 모두 나오는지
- 지도 위 상태 표시가 빨간색 "불러오기 실패"가 아닌지 (실패하면 표시된 이유와 환경변수를 확인)
- 출발지·목적지를 검색해 경로가 다시 조회되는지

## 요청 횟수 제한

| 대상 | IP별 연속 허용 | 회복 | IP별 하루 | 서비스 전체 하루 (외부 호출 기준) |
|---|---|---|---|---|
| 경로 조회 | 10회 | 6초에 1회 | 150회 | 카카오 자전거 경로 900건 |
| 장소 검색 | 40회 | 1.5초에 1회 | - | 카카오 장소 검색 90,000건 |
| 대여소·사고·예보 | 120회 | 1초에 2회 | - | - |

초과하면 HTTP 429와 `Retry-After` 헤더, 기다릴 시간이 담긴 메시지를 돌려줍니다. 하루 한도는 매일 0시(한국 시간)에 초기화됩니다.

## 폴더 구조

```
src/
  app/
    page.tsx                 화면 진입점
    api/*/route.ts           API Route (외부 API 프록시)
  components/                화면 (지도, 경로 비교, 대여소, 사고, 날씨)
  lib/
    server/                  서버 전용: 인증키, 외부 API 호출, 캐시, 요청 제한
    api-types.ts             API 응답 타입
    places.ts, route.ts, format.ts
scripts/check-client-secrets.mjs   브라우저 번들 키 노출 검사
```
