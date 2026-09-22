# 백엔드와 확정해야 할 것들

프론트는 제안 명세대로 구현하고 mock 으로 돌아가고 있다. 아래는 구현하면서
**확정이 아니라고 판단한 지점들**이다. 근거로 `skydetect-ai` 의
`ai_server/schemas.py`(A/B/C shared contract)를 읽었다.

---

## 1. HLS 경로가 두 가지로 적혀 있다

명세 본문은 프록시 대상으로 `/api` 와 `/hls` 를 둘 다 들었는데, 엔드포인트
목록에는 `GET /api/hls/live.m3u8` 만 있다.

- 프론트: 프록시는 **둘 다** 열어뒀다 (`vite.config.js`)
- 기본값은 mock 로컬 파일이고, 실서버 주소는 `.env` 의 `VITE_HLS_URL` 한 줄

**확정 필요** — `/api/hls/...` 인가 `/hls/...` 인가.
관련해서, HLS 세그먼트(.ts) 요청에도 세션 인증이 걸리는지도 확인이 필요하다.
`anyRequest().authenticated()` 라면 걸린다. 걸려도 same-origin 이라 쿠키는
자동으로 실리지만, 만료 시 hls.js 가 401 을 받는 경로는 `http.js` 를 타지 않아
전역 401 처리가 **동작하지 않는다.** (현재는 "스트림 끊김" 배지로만 뜬다)

## 2. `rejectReason` 어휘가 명세보다 넓다

명세에는 `"short_track" | null` 만 적혀 있는데, AI 의 `RejectReason` Literal 은
네 가지다.

```
short_track | feature_error | high_noise | low_confidence
```

- 프론트: 네 가지 모두 한국어 문구를 매핑해뒀다 (`AnalysisResult.vue`)
- 모르는 값이 오면 코드 문자열을 그대로 보여준다

**확정 필요** — 백엔드가 AI 값을 그대로 흘려보내는가, 아니면 자체 어휘로
다시 매핑하는가.

## 3. `uncertain` 일 때 `confidence` 가 0.0 이다

AI 의 `PredictionResult` 주석에 명시돼 있다: "RF 예측 확률 (uncertain 시 0.0)".

이건 "신뢰도 0%"가 아니라 **"점수를 매기지 않았다"**는 뜻이다. 0% 막대를 그리면
운영자에게 거짓말이 된다.

- 프론트: `uncertain` 이면 막대 대신 "분류 점수 없음"으로 표시한다

**확정 필요** — 백엔드가 이 0.0 을 그대로 내려보낼 것인지, `null` 로 바꿔줄 것인지.
`null` 쪽이 의미가 분명하다.

## 4. AI 가 주는 정보가 제안 명세에서 잘려나간다

AI 의 `PredictionResult` 에는 이런 게 더 있다.

| AI 필드 | 쓸모 |
| --- | --- |
| `rule_filter.reject_reason` | 위 2번 |
| `quality.num_points` | 몇 프레임이나 추적됐나 |
| `quality.mean_conf` | 평균 관측 신뢰도 |
| `quality.track_stability` | good / fair / poor |
| `quality.feature_status` | ok / partial / failed |
| `top_features` | 판단에 크게 기여한 특징 |

명세의 `GET /api/analyses/{id}` 는 `label` / `confidence` / `rejectReason` 만
남긴다. 그런데 "판단불가 사유를 가능하면 함께 보여줘라"는 요구를 제대로 채우려면
**`quality` 가 사실상 필요하다.** "추적 6프레임 · 평균 신뢰도 34% · 트랙 품질 불량"
이 붙어야 운영자가 다시 트리거할지 판단할 수 있다.

- 프론트: `quality` 와 `topFeatures` 를 **선택 필드**로 받아 있으면 그린다.
  없으면 그 줄만 빠진다. 백엔드가 나중에 흘려보내주면 코드 수정 없이 뜬다.

**제안** — `GET /api/analyses/{id}` 응답에 `quality` 를 포함시키자.

## 5. AI 는 좌표를 정규화해서 다루지만 입력은 원본 픽셀이다

헷갈리기 쉬운 지점이라 적어둔다. 확인한 결과 **명세대로가 맞다.**

- 입력 `ManualTrackingRequest.target_bbox` → **원본 픽셀** `(x, y, w, h)`.
  `manual_roi_tracker._scale_initial_bbox` 가 내부에서 처리 해상도로 환산한다
- 출력 `TrackPoint.cx/cy/w/h` → `processed_width/height` 기준 **0~1 정규화**

즉 프론트는 원본 픽셀로 보내면 된다. 다만 나중에 궤적을 화면에 겹쳐 그리는
기능을 만들면, 그때는 **정규화 좌표를 역변환**해야 한다. 지금 코드에는 없다.

## 6. 상태 폴링 간격과 타임아웃

- 현재 1초 간격 (`api/config.js` 의 `POLL_INTERVAL_MS`)
- **정해지지 않은 것**: 언제 포기하는가. 클립이 30초째 `PENDING` 이면?
  분석이 5분째 `RUNNING` 이면? 지금은 무한히 폴링한다
- `FAILED` 응답에 사유를 담을 필드가 명세에 없다. 화면에는 "구간을 잘라내지
  못했다"밖에 못 띄운다

**제안** — `FAILED` 에 `message` 나 `errorCode` 를 넣고, 서버가 판단하는
타임아웃을 `readyAt` 처럼 응답에 실어주면 프론트가 붙잡고 있지 않아도 된다.

## 7. `POST /api/clips` 의 트리거 시각

명세대로 요청 본문을 비우고 서버가 시각을 정하게 했다. 다만 운영자가 버튼을 누른
시각과 서버가 받은 시각 사이에 네트워크 지연이 있다.

- 13초 구간에서 수백 ms 는 무시할 만하다고 보고 그대로 뒀다
- 다만 클라이언트 시각을 같이 보내두면 나중에 분석할 거리가 된다

**확인 필요** — 무시할 수준으로 합의된 것인지.

## 8. `processing_time_ms` 는 분류기 시간만 담는다

AI 가 주는 `processing_time_ms` 는 RF 분류기 내부 시간이라 100ms 안쪽이다.
실제로 오래 걸리는 건 추적과 특징추출이다. 13초 1920x1080 클립으로 재보니
전체는 2분 가까이 걸렸는데 이 값은 0.1초로 왔다.

프론트는 화면의 "처리" 표시에 왕복 시간을 쓴다. 운영자가 기다린 시간이 그거라서다.

확정 필요 - 백엔드가 내려줄 `processingTimeMs` 가 파이프라인 전체 시간인지
분류기 시간인지. 전체 시간이어야 의미가 있다.

## 9. AI 직결 경로는 임시다

`src/api/ai.js` 는 백엔드에 분석 API 가 없는 동안 쓰는 개발용 우회로다.
`VITE_ANALYSIS_SOURCE=ai` 일 때만 동작하고, 클립 영상을 브라우저가 직접 AI 에
업로드한 뒤 `/api/tracks/manual` 을 부른다.

운영에 쓸 수 없는 이유

- AI 서버가 인증 없이 열려 있어야 한다
- 클립 영상이 브라우저를 한 번 왕복한다 (13초 1080p = 수 MB)
- AI 가 동기 처리라 요청이 수 분간 열려 있다. 타임아웃에 취약하다

백엔드가 `/api/clips/{id}/analysis` 를 열면 `backend` 로 바꾸고 이 파일은 지운다.

## 10. AI 의 overlay.mp4 는 브라우저에서 재생되지 않는다

`ai_server/services/tracking_video_io.py` 가 OpenCV `VideoWriter_fourcc(*"mp4v")`
로 오버레이를 쓴다. 결과물은 MPEG-4 Part 2(`codec_name=mpeg4`)이고, 브라우저는
이 코덱을 디코딩하지 못한다. H.264(avc1) 만 재생된다. 실제로 붙여보니
`readyState` 가 0 에서 올라가지 않았다.

- 프론트: overlay.mp4 를 `<video>` 에 붙이지 않는다. 대신 응답의 `TrackSequence`
  를 받아 원본 위에 캔버스로 직접 그린다 (`TrackOverlay.vue`). 오히려 원본
  해상도로 보이고 프레임을 앞뒤로 돌릴 수 있다. overlay.mp4 는 다운로드로만 둔다.

AI 쪽에서 고치려면 fourcc 를 `avc1` 로 바꾸거나 ffmpeg 로 H.264 재인코딩을
한 번 거치면 된다. 다만 OpenCV 의 `avc1` 은 플랫폼마다 openh264 가 있어야 해서
ffmpeg 쪽이 안전해 보인다. AI 레포 일이라 건드리지 않았다.

## 11. 분석 이력 `GET /api/analyses`

API 클라이언트 함수(`fetchAnalysisHistory`)는 만들어뒀지만 **화면은 만들지
않았다.** 요청 범위(1~8단계)에 없었다. 현재 세션 동안의 이력은 클립 큐가 대신
보여준다. 화면이 필요하면 말해달라 — 페이지네이션/기간 필터 같은 명세가 먼저
필요하다.
