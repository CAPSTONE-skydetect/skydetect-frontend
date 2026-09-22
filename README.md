# skydetect-frontend

SkyDetect 관제 화면. 하늘을 향한 고정 카메라의 라이브 영상을 보다가, 비행물체를
발견하면 그 구간을 잘라 AI 로 분류한다 (새 / 드론 / 판단불가).

Vue 3 (Composition API) + Vite. **SPA 라우터를 쓰지 않는다** — 화면이 사실상
하나(로그인 + 관제)라서 `App.vue` 의 분기 하나로 충분하다. 상태관리 라이브러리도
쓰지 않는다. `ref` 와 composable 로 충분한 규모다.

---

## 시작하기

```bash
npm install
bash scripts/make-mock-media.sh   # mock 영상 생성 (ffmpeg 필요, 최초 1회)
npm run dev                       # http://localhost:5173
```

백엔드(`skydetect-backend`)가 `localhost:8080` 에 떠 있어야 로그인이 된다.
테스트 계정은 백엔드의 `application-local.yaml` 에 설정된 `operator` 계정이다.

### 왜 프록시를 쓰는가

Vite dev server 가 `/api`, `/hls` 를 `localhost:8080` 으로 중계한다
(`vite.config.js`). 브라우저 입장에서는 전부 same-origin 이라

- `JSESSIONID`(HttpOnly) / `XSRF-TOKEN` 쿠키가 아무 설정 없이 그대로 오가고
- CORS preflight 도, `SameSite=Lax` 에 걸리는 일도 없다

프록시 없이 8080 을 직접 부르면 cross-site 가 되어 두 쿠키가 모두 막힌다.
**프록시는 편의 기능이 아니라 이 프로젝트의 인증 전략 그 자체다.**

---

## 구조

```
src/
├─ main.js                    엔트리. 라우터 없음
├─ App.vue                    로그인 여부에 따라 두 화면 중 하나
│
├─ api/                       ── 서버와 말하는 유일한 계층 ──
│  ├─ http.js                 ★ fetch 래퍼. CSRF 헤더 + 401 전역 처리
│  ├─ auth.js                 로그인/로그아웃/세션 확인 (실제 백엔드)
│  ├─ clips.js                클립 API   (mock ↔ real 스위치)
│  ├─ analyses.js             분석 API   (mock ↔ real 스위치)
│  ├─ config.js               환경 스위치 (USE_MOCK, HLS_URL, 폴링 간격)
│  └─ mock/mockBackend.js     인메모리 가짜 서버. 실제 지연을 흉내 낸다
│
├─ composables/
│  ├─ useAuth.js              인증 상태 싱글톤 + 401 핸들러 등록
│  ├─ useClipSession.js       ★ 화면 상태 기계 + 클립 큐
│  ├─ useHls.js               HLS 재생 (hls.js)
│  └─ usePolling.js           setTimeout 체인 폴러
│
├─ lib/videoGeometry.js       ★ 화면 좌표 ↔ 원본 픽셀 좌표 변환 (순수 함수)
│
└─ components/
   ├─ LoginView.vue
   ├─ ConsoleView.vue         좌우 2분할 레이아웃
   ├─ LivePanel.vue           왼쪽: 라이브 + 검출 트리거
   ├─ ClipPanel.vue           오른쪽: 다섯 상태의 분기
   ├─ BoxOverlay.vue          ★ canvas 박스 드로잉 + 좌표 검증 재투영
   ├─ AnalysisResult.vue      결과 (판단불가 포함)
   └─ ClipQueue.vue           동시 진행 중인 클립 목록
```

---

## 알아두면 좋은 것들

### 1. CSRF — 이걸 모르면 모든 POST 가 403 이다

`http.js` 한 곳에만 구현되어 있고 모든 호출이 그리로 지난다.

- `XSRF-TOKEN` 쿠키를 **매 요청마다 새로 읽는다.** 서버가 로그인/로그아웃마다
  토큰을 회전시키므로 변수에 캐싱하면 그 직후 요청이 403 이 된다.
- 앱 시작 시 `GET /api/auth/me` 를 한 번 부른다 (`App.vue` → `useAuth.initialize`).
  401 이 나도 상관없다. 목적의 절반은 **쿠키를 받아오는 것**이고, 이게 없으면
  첫 POST 인 로그인부터 403 이 난다.
- GET 에는 붙이지 않는다.

### 2. 세션 만료는 전역에서만 처리한다

유휴 30분(요청마다 리셋) + **절대 12시간(리셋 안 됨)** 이라, 화면이 잘 돌아가는
중에도 아무 요청이나 갑자기 401 이 될 수 있다. `http.js` 가 401 을 잡아
`useAuth` 가 등록한 핸들러를 부르고, 화면은 로그인 화면으로 되돌아간다.

예외는 두 개뿐이고 둘 다 `skipAuthHandler: true` 로 명시한다.

- 로그인 시도의 401 → "비밀번호 틀림"이지 만료가 아니다
- 앱 시작 시 `/api/auth/me` 의 401 → "아직 로그인 안 함"이지 만료가 아니다

### 3. 클립은 최소 10초 기다려야 한다

트리거는 **-3초 ~ +10초** 구간을 자른다. +10초는 누른 시점에 아직 오지 않은
시간이므로, 서버가 202 `PENDING` 과 `readyAt` 을 주고 프론트가 폴링한다.
기다리는 동안 왼쪽 라이브는 계속 흐르고 트리거를 또 누를 수 있다.

그래서 클립은 **큐**다 (`useClipSession`). 오른쪽 패널은 하나뿐이므로
"선택된 클립 하나"에 묶고, 자동 선택 규칙은 하나다 — **작업 중인 화면을 빼앗지
않는다.** 패널이 비어 있을 때만 새 트리거가 자동으로 잡히고, 박스를 그리는 중이나
결과를 보는 중이면 새 클립은 큐에 뱃지로만 쌓인다.

### 4. 박스 좌표는 원본 픽셀이다

`targetBbox` 는 원본 영상 픽셀 좌표다. 1920px 영상을 700px 폭으로 보고 있으면
0.36 배로 환산해야 하고, `object-fit: contain` 여백(레터박스)만큼 오프셋도 빼야
한다. 이 변환이 틀려도 **화면상으로는 전혀 티가 나지 않고 AI 결과만 이상해진다.**

그래서 `BoxOverlay` 는 그린 사각형을 그대로 보여주지 않는다.

1. 드래그 중 — 화면 좌표 그대로 (흰 점선)
2. 손을 떼면 — 원본 좌표로 변환 → **다시 화면 좌표로 되돌려서** 그린다 (파란 실선)

둘이 어긋나면 변환이 틀린 것이다. 패널 하단에 원본 해상도·실제 배율·레터박스
여백·최종 `targetBbox` 값이 같이 뜬다.

`initFrameIndex` 는 `Math.round(video.currentTime * fps)` 다. `fps` 는 반드시
클립 메타데이터에서 온 값을 쓴다 (`lib/videoGeometry.js`).

### 5. mock 레이어

클립·분석·HLS 는 백엔드에 아직 없다. `VITE_USE_MOCK`(기본 `true`)이 켜져 있으면
`api/mock/mockBackend.js` 가 응답한다. **지연을 실제와 같게 준다** — 클립 10초+,
분석 3~7초. 지연이 0이면 대기 UI 를 한 번도 못 보고 넘어가서, 나중에 실서버로
바꾸는 순간 없던 버그가 쏟아진다.

결과 라벨은 무작위가 아니라 `bird → drone → uncertain` 으로 **순환**한다.
세 번 분석하면 `판단불가` 화면까지 반드시 한 번은 보게 된다.

mock 은 `targetBbox` 가 원본 프레임(1920×1080) 밖이면 422 를 낸다. 좌표 변환이
틀렸을 때 조용히 넘어가지 않게 하려는 장치다.

실서버로 바꾸려면 `.env` 에 `VITE_USE_MOCK=false`, `VITE_HLS_URL=/api/hls/live.m3u8`.
호출부는 한 줄도 고치지 않는다.

### 6. HLS 엔진 선택 순서

`useHls.js` 는 `Hls.isSupported()` 를 **먼저** 본다. 흔한 구현처럼
`canPlayType('application/vnd.apple.mpegurl')` 을 먼저 보면 안 된다 —
Chromium 이 이 값으로 `'maybe'` 를 돌려주기 때문에 Safari 가 아닌데도 네이티브
경로로 빠져서 라이브 스트림이 조용히 안 나올 수 있다. (이 환경에서 실제로 확인했다)

---

## 백엔드와 맞춰야 할 것

`api/clips.js`, `api/analyses.js` 의 경로와 필드는 **제안이지 확정이 아니다.**
확정 전까지는 mock 으로 돈다. 자세한 미확정 목록은 [docs/api-questions.md](docs/api-questions.md).

---

## 배포

```bash
npm run build     # → dist/
```

산출물을 백엔드의 `src/main/resources/static/` 에 넣으면 같은 출처에서 서빙된다.
그때는 프록시가 없어도 same-origin 이므로 쿠키 처리는 그대로 동작한다.
