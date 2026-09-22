/**
 * 아직 백엔드에 없는 클립/분석 API 를 흉내 내는 인메모리 가짜 서버.
 *
 * 목적은 "화면이 그려진다"가 아니라 대기 UI 를 제대로 만드는 것이다.
 * 그래서 지연을 실제와 같게 준다.
 *   - 클립: 트리거 +10초가 아직 미래라서 최소 10초를 기다려야 한다
 *   - 분석: 수 초 ~ 수십 초
 * 지연이 0이면 PENDING 화면을 한 번도 못 보고 넘어가서, 나중에 실서버로
 * 바꾸는 순간 없던 버그가 쏟아진다.
 *
 * 실제 네트워크 호출은 하지 않지만 서명은 실 API 와 동일하게 맞춰두었다.
 * (src/api/clips.js / analyses.js 의 real 구현과 1:1 대응)
 */

// 시나리오 상수

/** 트리거 기준 잘라내는 구간. -3초 ~ +10초 = 13초. */
export const CLIP_PRE_ROLL_MS = 3_000
export const CLIP_POST_ROLL_MS = 10_000
export const CLIP_DURATION_MS = CLIP_PRE_ROLL_MS + CLIP_POST_ROLL_MS

/** mock 클립 영상. scripts/make-mock-media.sh 가 만든다. */
const MOCK_CLIP_VIDEO = '/mock/clip.mp4'
const MOCK_CLIP_FPS = 30
const MOCK_CLIP_WIDTH = 1920
const MOCK_CLIP_HEIGHT = 1080

/** 인코딩/업로드에 걸리는 여유. +10초가 지난 뒤에도 바로 준비되진 않는다. */
const CLIP_ENCODE_SLACK_MS = 1_500

const ANALYSIS_QUEUE_MS = 1_200          // PENDING → RUNNING
const ANALYSIS_MIN_RUN_MS = 3_000        // RUNNING → DONE (하한)
const ANALYSIS_MAX_RUN_MS = 7_000        // RUNNING → DONE (상한)

// 저장소

const clips = new Map()
const analyses = new Map()
let sequence = 0

function nextId(prefix) {
  sequence += 1
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}`
}

/**
 * 결과 라벨을 무작위가 아니라 순환시킨다.
 *
 * 무작위로 두면 uncertain 화면을 한 번도 못 보고 개발이 끝난다.
 * 세 번 분석하면 bird / drone / uncertain 을 모두 반드시 보게 된다.
 */
const LABEL_CYCLE = ['bird', 'drone', 'uncertain']
let labelCursor = 0

/**
 * uncertain 사유. skydetect-ai 의 RejectReason Literal 과 같은 어휘다.
 * (ai_server/schemas.py: short_track | feature_error | high_noise | low_confidence)
 */
const REJECT_CYCLE = ['short_track', 'low_confidence', 'high_noise']
let rejectCursor = 0

// 클립

/** POST /api/clips */
export async function createClip() {
  await networkLatency()

  const clipId = nextId('clip')
  const triggeredAt = Date.now()
  // 트리거 시각 +10초가 지나야 구간이 다 찬다. 거기에 인코딩 여유를 더한다.
  const readyAtMs = triggeredAt + CLIP_POST_ROLL_MS + CLIP_ENCODE_SLACK_MS

  clips.set(clipId, { clipId, triggeredAt, readyAtMs })

  return {
    clipId,
    status: 'PENDING',
    readyAt: new Date(readyAtMs).toISOString(),
  }
}

/** GET /api/clips/{clipId} */
export async function fetchClip(clipId) {
  await networkLatency()

  const record = clips.get(clipId)
  if (!record) throw notFound(`clip ${clipId}`)

  if (Date.now() < record.readyAtMs) {
    return {
      clipId,
      status: 'PENDING',
      readyAt: new Date(record.readyAtMs).toISOString(),
    }
  }

  return {
    clipId,
    status: 'READY',
    videoUrl: MOCK_CLIP_VIDEO,
    fps: MOCK_CLIP_FPS,
    width: MOCK_CLIP_WIDTH,
    height: MOCK_CLIP_HEIGHT,
    frameCount: Math.round((CLIP_DURATION_MS / 1000) * MOCK_CLIP_FPS),
    durationMs: CLIP_DURATION_MS,
    triggeredAt: new Date(record.triggeredAt).toISOString(),
  }
}

// 분석

/** POST /api/clips/{clipId}/analysis */
export async function createAnalysis(clipId, { initFrameIndex, targetBbox }) {
  await networkLatency()

  const clip = clips.get(clipId)
  if (!clip) throw notFound(`clip ${clipId}`)

  // 좌표 변환이 틀리면 화면상으로는 멀쩡해 보이므로, mock 이 대신 소리를 낸다.
  // 실서버/AI 도 원본 픽셀 좌표를 기대하므로 같은 검사를 하게 된다.
  assertBboxInsideFrame(targetBbox)

  const analysisId = nextId('anl')
  const startedAt = Date.now()
  const runMs = ANALYSIS_MIN_RUN_MS
    + Math.random() * (ANALYSIS_MAX_RUN_MS - ANALYSIS_MIN_RUN_MS)

  analyses.set(analysisId, {
    analysisId,
    clipId,
    initFrameIndex,
    targetBbox,
    startedAt,
    runningAtMs: startedAt + ANALYSIS_QUEUE_MS,
    doneAtMs: startedAt + ANALYSIS_QUEUE_MS + runMs,
    result: null,
  })

  return { analysisId, status: 'PENDING' }
}

/** GET /api/analyses/{analysisId} */
export async function fetchAnalysis(analysisId) {
  await networkLatency()

  const record = analyses.get(analysisId)
  if (!record) throw notFound(`analysis ${analysisId}`)

  const now = Date.now()
  if (now < record.runningAtMs) {
    return { analysisId, status: 'PENDING' }
  }
  if (now < record.doneAtMs) {
    return { analysisId, status: 'RUNNING' }
  }

  // 결과는 한 번만 만들고 고정한다. 폴링할 때마다 라벨이 바뀌면 안 된다.
  if (!record.result) record.result = buildResult(record)
  return record.result
}

/** GET /api/analyses — 분석 이력 */
export async function fetchAnalysisHistory() {
  await networkLatency()

  const now = Date.now()
  return [...analyses.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((record) => {
      if (now >= record.doneAtMs) {
        if (!record.result) record.result = buildResult(record)
        return record.result
      }
      return {
        analysisId: record.analysisId,
        clipId: record.clipId,
        status: now < record.runningAtMs ? 'PENDING' : 'RUNNING',
      }
    })
}

function buildResult(record) {
  const label = LABEL_CYCLE[labelCursor++ % LABEL_CYCLE.length]
  const processingTimeMs = record.doneAtMs - record.startedAt

  const base = {
    analysisId: record.analysisId,
    clipId: record.clipId,
    status: 'DONE',
    label,
    processingTimeMs,
    // 아래 두 필드는 제안 명세에는 없지만 skydetect-ai 의 PredictionResult 에는
    // 있는 값이다. 실서버가 그대로 흘려보내주면 화면이 바로 받아 쓴다.
    quality: {
      numPoints: label === 'uncertain' ? 6 : 128,
      meanConf: label === 'uncertain' ? 0.34 : 0.91,
      trackStability: label === 'uncertain' ? 'poor' : 'good',
      featureStatus: label === 'uncertain' ? 'partial' : 'ok',
    },
    topFeatures: label === 'drone'
      ? { tortuosity: 0.31, speed_cv: 0.24, turn_rate_p95: 0.18 }
      : { turn_rate_median: 0.29, heading_change_ratio: 0.26, curvature_cv: 0.2 },
  }

  if (label === 'uncertain') {
    return {
      ...base,
      // AI 는 uncertain 일 때 confidence 를 0.0 으로 준다. "신뢰도 0%"가 아니라
      // "점수를 매기지 않았다"는 뜻이므로 화면에서 다르게 표시해야 한다.
      confidence: 0,
      rejectReason: REJECT_CYCLE[rejectCursor++ % REJECT_CYCLE.length],
    }
  }

  return {
    ...base,
    confidence: 0.72 + Math.random() * 0.25,
    rejectReason: null,
  }
}

// 도우미

function assertBboxInsideFrame([x, y, w, h]) {
  const inside =
    Number.isFinite(x) && Number.isFinite(y) &&
    w > 0 && h > 0 &&
    x >= 0 && y >= 0 &&
    x + w <= MOCK_CLIP_WIDTH + 1 &&
    y + h <= MOCK_CLIP_HEIGHT + 1

  if (!inside) {
    const error = new Error(
      `targetBbox 가 원본 프레임(${MOCK_CLIP_WIDTH}×${MOCK_CLIP_HEIGHT}) 밖이다: ` +
      `[${[x, y, w, h].map((n) => Math.round(n)).join(', ')}]. 좌표 변환을 확인하세요.`,
    )
    error.status = 422
    error.code = 'BBOX_OUT_OF_RANGE'
    throw error
  }
}

function notFound(what) {
  const error = new Error(`${what} 를 찾을 수 없습니다.`)
  error.status = 404
  error.code = 'NOT_FOUND'
  return error
}

/** 폴링 간격보다 짧은 왕복 지연. 로딩 스피너가 한 번씩 깜빡이는 걸 보려고 넣는다. */
function networkLatency() {
  return new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120))
}
