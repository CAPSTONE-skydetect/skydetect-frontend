# skydetect-frontend

SkyDetect 관제 화면. 하늘을 향한 고정 카메라의 라이브 영상을 보다가, 비행물체를
발견하면 그 구간을 잘라 AI 로 분류한다 (새 / 드론 / 판단불가).

Vue 3 (Composition API) + Vite. SPA 라우터를 쓰지 않는다. 화면이 사실상
하나(로그인 + 관제)라서 `App.vue` 의 분기 하나로 충분하다. 상태관리 라이브러리도
쓰지 않는다.

---

## 시작하기

```bash
npm install
bash scripts/make-mock-media.sh   # mock 영상 생성 (ffmpeg 필요, 최초 1회)
npm run dev                       # http://localhost:5173
```

로그인하려면 백엔드가 떠 있어야 한다.

```bash
# skydetect-backend
gradlew.bat bootRun               # :8080

# skydetect-ai (선택. 분석을 진짜로 돌릴 때만)
venv\Scripts\python -m uvicorn ai_server.main:app --port 8000
```

### 왜 프록시를 쓰는가

Vite dev server 가 `/api`, `/hls` 를 백엔드로, `/ai` 를 AI 서버로 중계한다
(`vite.config.js`). 브라우저 입장에서는 전부 same-origin 이라

- `JSESSIONID`(HttpOnly) / `XSRF-TOKEN` 쿠키가 아무 설정 없이 그대로 오가고
- CORS preflight 도, `SameSite=Lax` 에 걸리는 일도 없다

프록시 없이 8080 을 직접 부르면 cross-site 가 되어 두 쿠키가 모두 막힌다.
프록시는 편의 기능이 아니라 이 프로젝트의 인증 전략 그 자체다.

AI 는 라우트가 백엔드와 똑같이 `/api` 로 시작해서 충돌한다. 그래서 `/ai` 접두어를
붙이고 중계할 때 떼어낸다.

```
/api/auth/me          -> localhost:8080/api/auth/me
/ai/health            -> localhost:8000/health
/ai/api/tracks/manual -> localhost:8000/api/tracks/manual
```

---

## 어디에 붙을지 고르기

`.env` 두 줄로 정한다 (`.env.example` 참고). 호출부는 한 줄도 안 고친다.

| | 값 | 뜻 |
| --- | --- | --- |
| `VITE_CLIP_SOURCE` | `mock` (기본) | 브라우저 메모리. 백엔드에 `/api/clips` 가 없을 때 |
| | `backend` | 실제 백엔드 |
| `VITE_ANALYSIS_SOURCE` | `mock` (기본) | 브라우저 메모리 |
| | `ai` | AI 서버(8000) 직결. 개발용 우회로 |
| | `backend` | 프론트 → 백엔드 → AI. 정식 경로 |

인증은 이 스위치와 무관하게 항상 실제 백엔드를 탄다.

헤더에 현재 어디에 붙어 있는지와 AI 서버 연결 상태가 뜬다.

### `ai` 모드가 하는 일

백엔드에 분석 API 가 아직 없어서, 그전까지 진짜 결과를 볼 수 있게 열어둔 길이다.
클립 영상을 AI 에 업로드(`/api/videos/upload`)한 뒤 `/api/tracks/manual` 을 부르고,
돌아온 `PredictionResult` 를 화면이 쓰는 모양으로 바꾼다 (`src/api/ai.js`).

AI 는 작업 큐가 없어서 한 번의 요청으로 끝까지 처리한다. 반면 화면은 202 + 폴링을
전제로 짜여 있어서 `ai.js` 가 작업 테이블을 들고 그 모양을 맞춰준다.

정식 경로는 프론트 → 백엔드 → AI 다. 백엔드가 분석 API 를 열면 `backend` 로 바꾸고
`ai.js` 는 지워도 된다.

---

## 화면 세 개

헤더 토글로 오간다. 라우터 라이브러리 없이 해시로만 구분한다
(`#/live`, `#/upload`, `#/history`). 새로고침과 뒤로가기가 그대로 동작한다.

| 화면 | 하는 일 |
| --- | --- |
| **실시간** | 왼쪽 라이브 HLS + 검출 → 오른쪽 클립에 박스 지정 → 분석 |
| **업로드 분석** | 왼쪽에 올린 영상 + ROI 지정 → 오른쪽에 A 파트 추적 오버레이와 판정 |
| **검출 기록** | 지금까지의 판정을 썸네일/설정값과 함께 되돌아본다 |

### 업로드 분석

AI(8000)를 직접 부른다. 백엔드를 거치지 않는 검증용 화면이다.

1. 영상을 올리면 `POST /ai/api/videos/upload` 로 AI 안에 저장된다
   (AI 는 서버 경로로만 작업한다). 왼쪽 재생은 올린 파일을 그대로 쓴다
2. 프레임을 고르고 드래그해서 ROI 를 그린다. 중심 X/Y 와 bbox W/H 는 숫자로도
   조정할 수 있다
3. 오른쪽에서 추적 파라미터를 맞추고 `ROI 추적`
4. 결과로 추적 오버레이 영상, 판정, 트랙 지표, 산출물 다운로드가 뜬다

추적 파라미터의 범위와 기본값은 AI 의 `tracking_schemas.py` 에서 가져왔고,
설명 문구는 CODEX 브랜치의 수동 ROI UI 에 있던 것을 그대로 옮겼다.

| 값 | 범위 | 기본 |
| --- | --- | --- |
| 유지 conf `klt_accept_conf` | 0.10 ~ 0.95 | 0.40 |
| 재탐색 conf `recovery_conf` | 0.10 ~ 0.95 | 0.58 |
| 학습 conf `update_conf` | 0.10 ~ 0.99 | 0.76 |
| 검색 반경 `search_radius_multiplier` | 1.0 ~ 8.0 | 2.5 |
| 온라인 외형 학습 `online_update_enabled` | | OFF |
| 카메라 움직임 보정 `stabilize` | | ON |
| 처리 해상도 `resize_width` | 320 ~ 7680 | 1280 |
| 추적 시간 `max_seconds` | 1 이상 (비우면 전체) | 10 |

학습 conf 는 온라인 외형 학습이 켜져야 의미가 있어서 OFF 일 때 흐리게 잠근다.

### 검출 기록

백엔드에 이력 API 가 없어서 **브라우저(localStorage)에 남긴다**. 그래서

- 이 브라우저에만 남는다. 다른 PC 에서는 안 보인다
- 방문 기록을 지우면 같이 사라진다
- 오버레이 영상은 AI 의 임시 파일이라 AI 를 다시 띄우면 링크가 끊긴다
  (썸네일은 남는다)

화면은 `lib/historyStore.js` 가 주는 모양만 보므로, 백엔드가 `GET /api/analyses` 를
열면 그 파일만 바꾸면 된다.

---

## 구조

```
src/
├─ main.js                    엔트리. 라우터 없음
├─ App.vue                    로그인 분기 + 해시로 화면 선택
│
├─ api/                       서버와 말하는 유일한 계층
│  ├─ http.js                 fetch 래퍼. CSRF 헤더 + 401 전역 처리
│  ├─ auth.js                 로그인/로그아웃/세션 확인 (항상 실제 백엔드)
│  ├─ clips.js                클립 API   (mock / backend)
│  ├─ analyses.js             분석 API   (mock / ai / backend)
│  ├─ ai.js                   AI 서버 직결 클라이언트
│  ├─ config.js               환경 스위치
│  └─ mock/mockBackend.js     인메모리 가짜 서버. 실제 지연을 흉내 낸다
│
├─ composables/
│  ├─ useAuth.js              인증 상태 싱글톤 + 401 핸들러 등록
│  ├─ useClipSession.js       화면 상태 기계 + 클립 큐
│  ├─ useHls.js               HLS 재생 (hls.js)
│  └─ usePolling.js           setTimeout 체인 폴러
│
├─ lib/videoGeometry.js       화면 좌표 ↔ 원본 픽셀 좌표 변환 (순수 함수)
│
├─ lib/historyStore.js       검출 기록 (localStorage)
├─ lib/videoThumbnail.js     기록 썸네일 캡처
│
└─ components/
   ├─ LoginView.vue
   ├─ AppShell.vue           헤더: 화면 토글 + AI 연결 상태 + 계정
   │
   ├─ ConsoleView.vue        [실시간] 좌우 2분할
   │  ├─ LivePanel.vue          왼쪽: 라이브 + 검출 버튼
   │  ├─ ClipPanel.vue          오른쪽: 다섯 상태의 분기
   │  └─ ClipQueue.vue          동시 진행 중인 클립 목록
   │
   ├─ UploadView.vue         [업로드 분석] 원본 + 추적 오버레이
   │  └─ TrackingTuning.vue     A 파트 파라미터 조절판
   │
   ├─ HistoryView.vue        [검출 기록] 목록 + 상세
   │
   ├─ BoxOverlay.vue         canvas 박스 드로잉 + 좌표 검증 재투영
   └─ AnalysisResult.vue     판정 카드 (판단불가 포함)
```

---

## 알아두면 좋은 것들

### 1. CSRF

`http.js` 한 곳에만 구현되어 있고 모든 호출이 그리로 지난다.

- `XSRF-TOKEN` 쿠키를 매 요청마다 새로 읽는다. 서버가 로그인/로그아웃마다 토큰을
  회전시키므로 변수에 캐싱하면 그 직후 요청이 403 이 된다.
- 앱 시작 시 `GET /api/auth/me` 를 한 번 부른다 (`App.vue` → `useAuth.initialize`).
  401 이 나도 상관없다. 목적의 절반은 쿠키를 받아오는 것이고, 이게 없으면 첫 POST 인
  로그인부터 403 이 난다.
- GET 에는 붙이지 않는다.

### 2. 세션 만료는 전역에서만 처리한다

유휴 30분(요청마다 리셋) + 절대 12시간(리셋 안 됨) 이라, 화면이 잘 돌아가는 중에도
아무 요청이나 갑자기 401 이 될 수 있다. `http.js` 가 401 을 잡아 `useAuth` 가 등록한
핸들러를 부르고, 화면은 로그인으로 되돌아간다.

예외는 두 개뿐이고 둘 다 `skipAuthHandler: true` 로 명시한다.

- 로그인 시도의 401 (비밀번호 틀림)
- 앱 시작 시 `/api/auth/me` 의 401 (아직 로그인 안 함)

### 3. 클립은 최소 10초 기다려야 한다

검출은 -3초 ~ +10초 구간을 자른다. +10초는 누른 시점에 아직 오지 않은 시간이므로,
서버가 202 `PENDING` 과 `readyAt` 을 주고 프론트가 폴링한다. 기다리는 동안 왼쪽
라이브는 계속 흐르고 검출을 또 누를 수 있다.

그래서 클립은 큐다 (`useClipSession`). 오른쪽 패널은 하나뿐이므로 "선택된 클립
하나"에 묶고, 자동 선택 규칙은 하나다. 작업 중인 화면을 빼앗지 않는다. 패널이 비어
있을 때만 새 검출이 자동으로 잡히고, 박스를 그리는 중이나 결과를 보는 중이면 새
클립은 큐에 뱃지로만 쌓인다.

### 4. 박스 좌표는 원본 픽셀이다

`targetBbox` 는 원본 영상 픽셀 좌표다. 1920px 영상을 736px 폭으로 보고 있으면
0.383 배로 환산해야 하고, `object-fit: contain` 여백(레터박스)만큼 오프셋도 빼야
한다. 이 변환이 틀려도 화면상으로는 티가 나지 않고 AI 결과만 이상해진다.

그래서 `BoxOverlay` 는 그린 사각형을 그대로 보여주지 않는다.

1. 드래그 중 — 화면 좌표 그대로 (흰 점선)
2. 손을 떼면 — 원본 좌표로 변환 → 다시 화면 좌표로 되돌려서 그린다 (파란 실선)

둘이 어긋나면 변환이 틀린 것이다. 패널 하단에 원본 해상도, 실제 배율, 레터박스
여백, 최종 bbox 값이 같이 뜬다.

`initFrameIndex` 는 `Math.round(video.currentTime * fps)` 다. `fps` 는 반드시 클립
메타데이터에서 온 값을 쓴다 (`lib/videoGeometry.js`).

### 5. mock 은 지연을 실제와 같게 준다

클립 11.5초, 분석 3~7초. 지연이 0이면 대기 UI 를 한 번도 못 보고 넘어가서, 나중에
실서버로 바꾸는 순간 없던 버그가 쏟아진다.

결과 라벨은 무작위가 아니라 `bird → drone → uncertain` 으로 순환한다. 세 번 분석하면
판단불가 화면까지 반드시 한 번은 보게 된다.

mock 은 `targetBbox` 가 원본 프레임 밖이면 422 를 낸다. 좌표 변환이 틀렸을 때 조용히
넘어가지 않게 하려는 장치다.

### 6. HLS 엔진 선택 순서

`useHls.js` 는 `Hls.isSupported()` 를 먼저 본다. 흔한 구현처럼
`canPlayType('application/vnd.apple.mpegurl')` 을 먼저 보면 안 된다. Chromium 이 이
값으로 `'maybe'` 를 돌려주기 때문에 Safari 가 아닌데도 네이티브 경로로 빠져서 라이브
스트림이 조용히 안 나올 수 있다.

---

## 백엔드와 맞춰야 할 것

`api/clips.js`, `api/analyses.js` 의 경로와 필드는 제안이지 확정이 아니다.
[docs/api-questions.md](docs/api-questions.md) 참고.

---

## 배포

```bash
npm run build     # -> dist/
```

산출물을 백엔드의 `src/main/resources/static/` 에 넣으면 같은 출처에서 서빙된다.
그때는 프록시가 없어도 same-origin 이므로 쿠키 처리는 그대로 동작한다.
