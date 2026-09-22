/**
 * AI 서버(FastAPI, 기본 8000) 직결 클라이언트.
 *
 * 정식 경로는 프론트 → 백엔드 → AI 다. 이 파일은 백엔드에 분석 API 가 생기기
 * 전까지 쓰는 개발용 우회로다. 로컬에 AI 를 띄워두면 mock 대신 진짜 결과를
 * 볼 수 있다. VITE_ANALYSIS_SOURCE=ai 일 때만 쓰인다.
 *
 * AI 는 비동기 작업 큐가 없고 한 번의 요청으로 끝까지 처리한다. 반면 화면은
 * 202 + 폴링을 전제로 짜여 있어서, 여기서 작업 테이블을 들고 그 모양을 맞춰준다.
 */
import { AI_BASE } from './config.js'

/** analysisId -> { status, result, error } */
const jobs = new Map()
let sequence = 0

/** GET /health — AI 가 떠 있는지 확인 */
export async function fetchHealth() {
  const response = await fetch(`${AI_BASE}/health`, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(`AI 서버 응답 ${response.status}`)
  return response.json()
}

/**
 * 분석 시작. 즉시 analysisId 를 돌려주고 뒤에서 실제 작업을 돌린다.
 *
 * @param {string} clipId
 * @param {object} payload  { initFrameIndex, targetBbox }
 * @param {object} context  { videoUrl } 클립 영상 주소. AI 에 업로드해야 한다
 */
export async function createAnalysis(clipId, payload, context = {}) {
  if (!context.videoUrl) {
    throw Object.assign(new Error('클립 영상 주소가 없어 AI 로 보낼 수 없습니다.'), {
      status: 400, code: 'NO_VIDEO_URL',
    })
  }

  sequence += 1
  const analysisId = `ai_${Date.now().toString(36)}${sequence.toString(36)}`
  jobs.set(analysisId, { status: 'RUNNING', result: null, error: null })

  // 기다리지 않는다. 화면은 폴링으로 진행 상황을 본다.
  run(analysisId, clipId, payload, context.videoUrl)

  return { analysisId, status: 'PENDING' }
}

/** 상태 조회. 화면의 폴러가 이걸 1초마다 부른다. */
export async function fetchAnalysis(analysisId) {
  const job = jobs.get(analysisId)
  if (!job) {
    throw Object.assign(new Error('분석 작업을 찾을 수 없습니다.'), { status: 404 })
  }
  if (job.status === 'FAILED') {
    return { analysisId, status: 'FAILED', message: job.error?.message }
  }
  if (job.status === 'DONE') return job.result
  return { analysisId, status: job.status }
}

export async function fetchAnalysisHistory() {
  return [...jobs.entries()]
    .filter(([, job]) => job.status === 'DONE')
    .map(([, job]) => job.result)
}


async function run(analysisId, clipId, payload, videoUrl) {
  const startedAt = Date.now()
  try {
    // 1) 클립 영상을 받아서 AI 에 업로드한다.
    //    AI 는 서버 안의 파일 경로로만 작업하므로 업로드가 먼저다.
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) throw new Error(`클립 영상을 읽지 못했습니다 (${videoResponse.status})`)
    const blob = await videoResponse.blob()

    const form = new FormData()
    form.append('file', blob, `${clipId}.mp4`)

    const uploaded = await postJson(`${AI_BASE}/api/videos/upload`, { body: form })

    // 2) 수동 ROI 추적 + 특징추출 + 분류를 한 번에 돌린다.
    const tracked = await postJson(`${AI_BASE}/api/tracks/manual`, {
      json: {
        source_video_id: uploaded.source_video_id,
        video_path: uploaded.video_path,
        init_frame_index: payload.initFrameIndex,
        // AI 도 원본 픽셀 좌표를 기대한다.
        // (manual_roi_tracker._scale_initial_bbox 가 내부에서 처리 해상도로 환산)
        target_bbox: payload.targetBbox,
      },
    })

    jobs.set(analysisId, {
      status: 'DONE',
      result: toAnalysisDto(analysisId, clipId, tracked.prediction, Date.now() - startedAt),
      error: null,
    })
  } catch (error) {
    jobs.set(analysisId, { status: 'FAILED', result: null, error })
  }
}

async function postJson(url, { json, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : body,
  })
  const text = await response.text()
  const parsed = text ? safeParse(text) : null
  if (!response.ok) {
    const detail = parsed?.detail || parsed?.message || text || response.statusText
    throw new Error(`AI 오류 ${response.status}: ${detail}`)
  }
  return parsed
}

function safeParse(text) {
  try { return JSON.parse(text) } catch { return text }
}

/**
 * AI 의 PredictionResult 를 화면이 쓰는 모양으로 맞춘다.
 * 백엔드가 분석 API 를 열면 이 변환은 백엔드 쪽으로 옮겨간다.
 */
function toAnalysisDto(analysisId, clipId, prediction, elapsedMs) {
  if (!prediction) {
    return { analysisId, clipId, status: 'FAILED', message: 'AI 응답에 prediction 이 없습니다.' }
  }

  const quality = prediction.quality
  return {
    analysisId,
    clipId,
    status: 'DONE',
    label: prediction.label,
    confidence: prediction.confidence,
    rejectReason: prediction.rule_filter?.reject_reason ?? null,
    // AI 의 processing_time_ms 는 분류기 내부 시간(수십 ms)이라 운영자가 기다린
    // 시간과 다르다. 추적/특징추출이 대부분을 차지한다. 화면의 "처리"는 실제
    // 대기 시간을 뜻하므로 왕복 시간을 쓴다.
    processingTimeMs: elapsedMs,
    classifyTimeMs: prediction.processing_time_ms ?? null,
    quality: quality ? {
      numPoints: quality.num_points,
      meanConf: quality.mean_conf,
      trackStability: quality.track_stability,
      featureStatus: quality.feature_status,
    } : null,
    topFeatures: prediction.top_features || null,
  }
}
