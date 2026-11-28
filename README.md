<div align="center">

# SkyDetect Frontend

**드론 · 조류 판별 시스템 SkyDetect의 관제 화면**

실시간 영상 · ROI 지정 · 판정 결과 · 관측 기록

</div>

---

## 개요

SkyDetect는 공항 주변 영상에서 비행 물체를 추적하고, 움직임 궤적으로 드론과 새를 판별하는 시스템입니다.
이 저장소는 관제 요원이 사용하는 웹 화면입니다. 카메라 실시간 영상을 보다가 비행 물체를 발견하면 해당 구간을 클립으로 잘라 물체를 지정하고, AI 판정 결과와 근거를 확인합니다.

> 단국대학교 SW중심대학사업단 2026 캡스톤 프로젝트이며, **2026 캡스톤 페스티벌 우수상**을 받았습니다.

## 주요 기능

| 화면 | 기능 |
| --- | --- |
| **실시간** (`#/live`) | 라즈베리파이 카메라 영상을 WebRTC(WHEP)로 지연 없이 표시하고, 검출 버튼으로 -3초 ~ +10초 클립 생성. 클립에서 물체 영역(ROI)을 지정해 분석 |
| **업로드 분석** (`#/upload`) | 영상을 올리고 ROI를 지정해 추적 · 판정. 추적 경로를 원본 위에 겹쳐 프레임 단위로 확인 |
| **검출 기록** (`#/history`) | 판정 결과를 썸네일, 위치, 메모와 함께 저장하고 다시 확인 |

- **판정 근거 표시**: 새 / 드론 / 판단불가 결과와 함께 모델이 어느 구간을 보고 판단했는지 보여줍니다.
- **모바일 지원**: 홈 화면에 설치할 수 있는 웹앱(PWA)이며, 폰 카메라로 촬영한 영상을 바로 분석할 수 있습니다.
- **계정**: 로그인, 회원가입, 아이디 찾기, 비밀번호 재설정
- **한국어 / 영어** 화면 전환

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| Framework | Vue 3 (Composition API) |
| Build | Vite |
| 영상 | WebRTC (WHEP), hls.js, Canvas |
| 배포 | nginx (Docker), Cloud Storage + Cloud CDN, GitHub Actions |

라우터와 상태관리 라이브러리 없이, 해시 기반 화면 전환과 composable로 구성했습니다.

## 시작하기

### 요구 사항

- Node.js 18 이상
- 로그인하려면 [skydetect-backend](https://github.com/CAPSTONE-skydetect/skydetect-backend)가 실행 중이어야 합니다.

### 로컬 실행

```bash
npm install
cp .env.example .env               # 선택. 없으면 기본값(mock)으로 동작
bash scripts/make-mock-media.sh    # mock 라이브 영상 생성 (ffmpeg 필요, 최초 1회)
npm run dev                        # http://localhost:5173
```

Vite 개발 서버가 `/api`는 백엔드(8080)로, `/ai`는 AI 서버(8000)로 중계합니다. 브라우저 입장에서는 모두 같은 출처라 세션 쿠키와 CSRF 토큰이 별도 설정 없이 동작합니다.

전체 시스템을 한 번에 실행하려면 [skydetect-ai의 Docker Compose 구성](https://github.com/CAPSTONE-skydetect/skydetect-ai/tree/dev/docker)을 사용하세요.

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_BACKEND_ORIGIN` | `http://localhost:8080` | 백엔드 주소 (개발 프록시 대상) |
| `VITE_AI_ORIGIN` | `http://localhost:8000` | AI 서버 주소 |
| `VITE_CLIP_SOURCE` | `mock` | 클립 출처. `mock` / `backend` / `local` / `spring-pi` |
| `VITE_ANALYSIS_SOURCE` | `mock` | 분석 요청 대상. `mock` / `ai` / `backend` |
| `VITE_HLS_URL` | `/mock/hls/live.m3u8` | 라이브 HLS 주소 |
| `VITE_WHEP_URL` | – | WebRTC 미리보기 주소 |

`mock` 모드는 실제 서버와 비슷한 지연을 흉내 내므로, 백엔드나 AI 서버 없이도 화면 흐름을 확인할 수 있습니다.

## 프로젝트 구조

```text
src/
├── App.vue           # 로그인 분기 + 해시 기반 화면 전환
├── api/              # 서버 통신 계층 (CSRF, 401 처리, mock 서버)
├── composables/      # 인증, 클립 세션, HLS / WebRTC 재생, 폴링
├── components/       # 화면과 UI 컴포넌트
├── lib/              # 좌표 변환, 오버레이, PWA 설치, 폰 촬영 등 순수 로직
└── styles/
public/               # PWA manifest, service worker, 아이콘
tests/                # node:test 단위 테스트
```

## 테스트

```bash
node --test tests/*.test.js
```

## 빌드 및 배포

```bash
npm run build     # dist/
```

`main`에 push 되면 GitHub Actions가 라즈베리파이 실시간 모드로 빌드해 Cloud Storage 버킷에 올리고 Cloud CDN 캐시를 비웁니다. 로컬 Docker 실행 시에는 nginx가 정적 파일을 서빙하고 API를 프록시합니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 화면 상태 설계, CSRF · 세션 만료 처리, 좌표 변환, HLS 엔진 선택 등 구현 상세 |
| [docs/api-questions.md](docs/api-questions.md) | 백엔드와 맞춘 API 질문 목록 |

## 관련 저장소

| 저장소 | 역할 |
| --- | --- |
| [skydetect-ai](https://github.com/CAPSTONE-skydetect/skydetect-ai) | 추적 · 분류 AI 서버, 전체 실행 · 배포 구성 |
| [skydetect-backend](https://github.com/CAPSTONE-skydetect/skydetect-backend) | Spring Boot API (인증, 클립, 관측 기록) |
