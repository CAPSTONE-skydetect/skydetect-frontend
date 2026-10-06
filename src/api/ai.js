/**
 * AI 서버(FastAPI, 기본 8000) 클라이언트.
 *
 * 두 가지로 쓰인다.
 *   1. 실시간 화면 - 클립을 올려 분석시키는 우회로 (VITE_ANALYSIS_SOURCE=ai)
 *      정식 경로는 프론트 → 백엔드 → AI 다. 백엔드에 분석 API 가 생기면 지운다.
 *   2. 업로드 분석 화면 - 사용자가 올린 영상을 그대로 A 파트 파이프라인에 태운다
 *
 * AI 는 작업 큐가 없고 한 번의 요청으로 끝까지 처리한다. 13초 1080p 클립이
 * 2분 가까이 걸리므로 타임아웃을 걸지 않는다.
 */
import { aiBase, aiModel } from '../lib/aiModel.js'

/** TrackingTuning 의 pydantic 기본값과 같다. */
export const DEFAULT_TUNING = {
  kltAcceptConf: 0.40,
  recoveryConf: 0.58,
  updateConf: 0.76,
  searchRadius: 2.5,
  onlineUpdate: false,
}

/**
 * AI 가 주는 다운로드 주소는 자기 기준(/api/files?...)이라 프록시 접두어를 붙인다.
 * 파일은 그 결과를 만든 서버에 있으므로, 결과를 낸 모델의 접두어를 넘긴다.
 */
export function toProxiedUrl(url, base = aiBase()) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return base + url
}

/** GET /health */
export async function fetchHealth(base = aiBase()) {
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(`AI 서버 응답 ${response.status}`)
  return response.json()
}

/**
 * 영상 업로드. AI 는 서버 안의 파일 경로로만 작업하므로 추적 전에 반드시 거친다.
 * @returns {Promise<{source_video_id:string, video_path:string, metadata:object}>}
 */
export async function uploadVideo(file, filename, base = aiBase()) {
  const form = new FormData()
  form.append('file', file, filename || file.name || 'clip.mp4')
  return send(`${base}/api/videos/upload`, { body: form })
}

/**
 * 수동 ROI 추적 + 특징추출 + 분류.
 *
 * @param {object} p
 * @param {string} p.sourceVideoId
 * @param {string} p.videoPath
 * @param {number} p.initFrameIndex
 * @param {[number,number,number,number]} p.targetBbox  원본 픽셀 [x, y, w, h]
 * @param {boolean} p.stabilize
 * @param {number} p.resizeWidth
 * @param {number|null} p.maxSeconds
 * @param {object} p.tuning  DEFAULT_TUNING 과 같은 모양
 * @param {string} [base]  업로드한 서버와 같은 접두어여야 한다 (영상 경로가 그 서버 기준)
 */
export async function runManualTracking(p, base = aiBase()) {
  const payload = {
    source_video_id: p.sourceVideoId,
    video_path: p.videoPath,
    init_frame_index: p.initFrameIndex,
    // AI 도 원본 픽셀 좌표를 기대한다.
    // (manual_roi_tracker._scale_initial_bbox 가 내부에서 처리 해상도로 환산)
    target_bbox: p.targetBbox,
    stabilize: p.stabilize,
    resize_width: p.resizeWidth,
    write_overlay: true,
    tuning: {
      klt_accept_conf: p.tuning.kltAcceptConf,
      recovery_conf: p.tuning.recoveryConf,
      update_conf: p.tuning.updateConf,
      search_radius_multiplier: p.tuning.searchRadius,
      online_update_enabled: p.tuning.onlineUpdate,
    },
  }
  // ManualTrackingRequest 는 extra="forbid" 이고 max_seconds 는 gt=0 이다.
  // null 을 넣으면 거부되므로 값이 있을 때만 싣는다.
  if (Number.isFinite(p.maxSeconds) && p.maxSeconds > 0) payload.max_seconds = p.maxSeconds

  return send(`${base}/api/tracks/manual`, { json: payload })
}

/**
 * 궤적 CSV(trajectory.csv)를 받아 화면에 그릴 점 목록으로 바꾼다.
 *
 * 왜 TrackSequence.history 를 안 쓰는가:
 *   history 의 cx/cy 는 stabilize=true 일 때 카메라 움직임 보정 좌표다
 *   (`tracking_adapter._to_track_point`: compensated_x if stabilize else raw_x).
 *   보정 좌표는 흔들림을 걷어낸 가상의 기준계라 실제 프레임에서 물체가 보이는
 *   자리가 아니다. 실측해보니 raw 와 최대 x 28.8px / y 44.3px 어긋났고,
 *   대상 bbox 가 17x12px 이라 박스 서너 개만큼 벗어난다.
 *   AI 자신의 overlay.mp4 도 raw_x/raw_y 로 그린다
 *   (`manual_roi_tracker` 의 오버레이 루프).
 *   그래서 화면에 겹쳐 그릴 때는 CSV 의 raw 좌표를 쓴다.
 *
 * 좌표 단위는 처리 해상도 픽셀이므로 0~1 비율로 바꿔서 돌려준다.
 * 처리 해상도는 원본의 등비 축소라 비율은 원본에서도 그대로 쓸 수 있다.
 */
export async function fetchTrajectory(url, { processedWidth, processedHeight }) {
  if (!url || !processedWidth || !processedHeight) return null

  const response = await fetch(url)
  if (!response.ok) return null

  const text = await response.text()
  // CSV 줄바꿈이 CRLF 일 수 있어 끝의 공백/CR 을 떼어낸다.
  const rows = text.trim().split('\n').map((line) => line.trimEnd())
  const headerLine = rows[0]
  const lines = rows.slice(1)
  if (!headerLine) return null

  const columns = headerLine.split(',')
  const at = (row, name) => row[columns.indexOf(name)]

  return lines.filter(Boolean).map((line) => {
    const row = line.split(',')
    return {
      frameIndex: Number(at(row, 'frame_index')),
      cx: Number(at(row, 'raw_x')) / processedWidth,
      cy: Number(at(row, 'raw_y')) / processedHeight,
      w: Number(at(row, 'bbox_width')) / processedWidth,
      h: Number(at(row, 'bbox_height')) / processedHeight,
      conf: Number(at(row, 'confidence')),
      // 화면 밖으로 나갔거나 추적을 놓친 프레임. AI 오버레이도 이때는
      // 궤적에 점을 더하지 않는다.
      visible: at(row, 'visible') === 'True',
      source: at(row, 'tracking_source'),
    }
  }).filter((point) => Number.isFinite(point.frameIndex) && Number.isFinite(point.cx))
}

/** CSV 를 못 받았을 때의 대비책. 보정 좌표라 카메라가 움직이면 어긋난다. */
export function pointsFromHistory(track) {
  return (track?.history || []).map((point) => ({
    frameIndex: point.frame_index,
    cx: point.cx,
    cy: point.cy,
    w: point.w,
    h: point.h,
    conf: point.conf,
    visible: true,
    source: 'compensated',
  }))
}

/**
 * AI 의 PredictionResult 를 화면이 쓰는 모양으로 맞춘다.
 *
 * 모델마다 응답 모양이 다르다.
 *   RF         confidence(확률) + rule_filter.reject_reason + top_features
 *   MiniRocket decision_score(Ridge margin, 확률 아님) + abstain_reason + 창별 점수
 * 화면은 model 을 보고 표시 방식을 고른다.
 *
 * @param {string} [model]  응답의 model 필드. 없으면 RF 로 본다 (이전 서버 호환)
 */
export function toAnalysisDto(prediction, { analysisId, clipId, elapsedMs, model = 'rf' } = {}) {
  if (!prediction) return null

  const quality = prediction.quality
  return {
    analysisId,
    clipId,
    status: 'DONE',
    model,
    label: prediction.label,
    confidence: prediction.confidence ?? null,
    // MiniRocket: 양수면 drone, 음수면 bird 쪽. 크기가 클수록 분리가 뚜렷하다.
    decisionScore: prediction.decision_score ?? null,
    windowsUsed: prediction.windows_used ?? null,
    modelVersion: prediction.model_version ?? null,
    rejectReason: prediction.rule_filter?.reject_reason ?? prediction.abstain_reason ?? null,
    rejectDetail: prediction.abstain_detail ?? null,
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

// 실시간 화면용 작업 테이블
// 화면은 202 + 폴링을 전제로 짜여 있는데 AI 는 동기 처리라 여기서 모양을 맞춘다.

/** analysisId -> { status, result, error } */
const jobs = new Map()
let sequence = 0

export async function createAnalysis(clipId, payload, context = {}) {
  if (!context.videoUrl) {
    throw Object.assign(new Error('클립 영상 주소가 없어 AI 로 보낼 수 없습니다.'), {
      status: 400, code: 'NO_VIDEO_URL',
    })
  }

  sequence += 1
  const analysisId = `ai_${Date.now().toString(36)}${sequence.toString(36)}`
  jobs.set(analysisId, { status: 'RUNNING', result: null, error: null })

  run(analysisId, clipId, payload, context.videoUrl)
  return { analysisId, status: 'PENDING' }
}

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
  return [...jobs.values()].filter((job) => job.status === 'DONE').map((job) => job.result)
}

async function run(analysisId, clipId, payload, videoUrl) {
  const startedAt = Date.now()
  // 분석 도중 토글을 바꿔도 업로드한 서버와 같은 서버로 끝까지 보낸다.
  const base = aiBase()
  const requestedModel = aiModel.value
  try {
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) throw new Error(`클립 영상을 읽지 못했습니다 (${videoResponse.status})`)

    const uploaded = await uploadVideo(await videoResponse.blob(), `${clipId}.mp4`, base)
    const tracked = await runManualTracking({
      sourceVideoId: uploaded.source_video_id,
      videoPath: uploaded.video_path,
      initFrameIndex: payload.initFrameIndex,
      targetBbox: payload.targetBbox,
      stabilize: true,
      resizeWidth: 1280,
      maxSeconds: null,
      tuning: DEFAULT_TUNING,
    }, base)

    const dto = toAnalysisDto(tracked.prediction, {
      analysisId, clipId, elapsedMs: Date.now() - startedAt,
      model: tracked.model || requestedModel,
    })
    const track = tracked.tracks?.[0] || null
    // overlay.mp4 는 OpenCV 'mp4v' 라 브라우저가 못 읽는다. 화면은 궤적을 받아
    // 캔버스로 직접 그린다. url 은 다운로드용으로만 둔다.
    const points = await fetchTrajectory(
      toProxiedUrl(tracked.download_urls?.trajectory, base),
      {
        processedWidth: track?.processed_width,
        processedHeight: track?.processed_height,
      },
    ).catch(() => null)

    jobs.set(analysisId, {
      status: 'DONE',
      result: {
        ...dto,
        overlayUrl: toProxiedUrl(tracked.download_urls?.overlay, base),
        track,
        points: points || pointsFromHistory(track),
        fps: tracked.metadata?.fps || null,
      },
      error: null,
    })
  } catch (error) {
    jobs.set(analysisId, { status: 'FAILED', result: null, error })
  }
}

// ---------------------------------------------------------------------------

async function send(url, { json, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : body,
  })
  const text = await response.text()
  const parsed = text ? safeParse(text) : null
  if (!response.ok) {
    const detail = parsed?.detail || parsed?.message || text || response.statusText
    throw new Error(`AI 오류 ${response.status}: ${formatDetail(detail)}`)
  }
  return parsed
}

/** FastAPI 검증 오류는 배열로 온다. 그대로 찍으면 [object Object] 가 된다. */
function formatDetail(detail) {
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc || []).join('.')} ${d.msg || ''}`.trim()).join(', ')
  }
  if (typeof detail === 'object' && detail !== null) return JSON.stringify(detail)
  return String(detail)
}

function safeParse(text) {
  try { return JSON.parse(text) } catch { return text }
}
