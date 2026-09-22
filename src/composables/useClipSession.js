/**
 * 관제 화면의 상태 기계.
 *
 * 화면 다섯 상태
 *   IDLE → CLIP_PENDING → CLIP_READY → ANALYZING → DONE
 * 는 "오른쪽 패널이 지금 보여주는 클립 하나"의 상태를 그대로 따라간다.
 *
 * ── 여기가 이 파일의 핵심 설계 지점 ──────────────────────────────────────
 * 클립은 동시에 여러 개가 PENDING 일 수 있는데(대기 중에도 트리거를 또 누를 수
 * 있어야 한다), 오른쪽 패널은 하나뿐이다. 그래서 클립을 **큐**로 들고,
 * 패널은 그중 "선택된 하나"에 묶는다.
 *
 * 자동 선택 규칙은 하나다: **작업 중인 화면을 빼앗지 않는다.**
 *   - 패널이 비어 있으면(IDLE) 새 트리거를 바로 선택해 대기 화면을 보여준다
 *   - 박스를 그리는 중이거나 분석 중/결과를 보는 중이면 새 클립은 큐에 쌓아두고
 *     뱃지만 띄운다. 사용자가 직접 고르면 그때 바꾼다
 * 이게 없으면 결과를 읽는 도중 다음 클립이 화면을 덮어버린다.
 */
import { ref, computed, onScopeDispose } from 'vue'
import { createClip, fetchClip } from '../api/clips.js'
import { createAnalysis, fetchAnalysis } from '../api/analyses.js'
import { POLL_INTERVAL_MS } from '../api/config.js'
import { startPolling } from './usePolling.js'

export function useClipSession() {
  /** @type {import('vue').Ref<ClipEntry[]>} 최신이 앞. */
  const clips = ref([])
  const selectedClipId = ref(null)
  const triggerError = ref(null)
  const triggering = ref(false)

  /** clipId/analysisId → 폴링 중단 함수 */
  const pollers = new Map()

  const selectedClip = computed(
    () => clips.value.find((clip) => clip.clipId === selectedClipId.value) || null,
  )

  const pendingCount = computed(
    () => clips.value.filter((clip) => clip.status === 'PENDING').length,
  )

  /**
   * 화면 상태. 어디에도 따로 저장하지 않고 선택된 클립에서 **파생**시킨다.
   * 상태를 따로 들면 클립 상태와 화면 상태가 어긋나는 순간이 반드시 생긴다.
   */
  const screenState = computed(() => {
    const clip = selectedClip.value
    if (!clip) return 'IDLE'
    if (clip.status === 'PENDING') return 'CLIP_PENDING'
    if (clip.status === 'FAILED') return 'CLIP_FAILED'

    const analysis = clip.analysis
    if (!analysis) return 'CLIP_READY'
    if (analysis.status === 'FAILED') return 'ANALYSIS_FAILED'
    if (analysis.status === 'DONE') return 'DONE'
    return 'ANALYZING'
  })

  /** 지금 화면을 빼앗으면 안 되는 상태인가. */
  const panelIsBusy = computed(() => screenState.value !== 'IDLE')

  // --- 트리거 ---------------------------------------------------------------

  /**
   * 검출 트리거. 누른 순간 -3초는 이미 서버에 있고, +10초는 아직 미래다.
   * 그래서 응답은 즉시 오지만 클립은 아직 없다 (202 PENDING).
   */
  async function trigger() {
    triggering.value = true
    triggerError.value = null
    try {
      const created = await createClip()

      const entry = {
        clipId: created.clipId,
        status: created.status,
        readyAt: created.readyAt ? Date.parse(created.readyAt) : null,
        triggeredAt: Date.now(),
        meta: null,
        analysis: null,
        analysisError: null,
        error: null,
      }
      clips.value = [entry, ...clips.value]

      // 패널이 놀고 있을 때만 자동으로 잡는다.
      if (!panelIsBusy.value) selectedClipId.value = entry.clipId

      watchClip(entry.clipId)
      return entry
    } catch (error) {
      triggerError.value = error
      throw error
    } finally {
      triggering.value = false
    }
  }

  /** PENDING 인 동안 1초 간격으로 상태를 확인한다. READY/FAILED 면 멈춘다. */
  function watchClip(clipId) {
    stopPoller(clipId)

    const stop = startPolling(() => fetchClip(clipId), {
      intervalMs: POLL_INTERVAL_MS,
      isDone: (dto) => dto.status !== 'PENDING',
      onResult: (dto) => {
        patchClip(clipId, (entry) => ({
          ...entry,
          status: dto.status,
          readyAt: dto.readyAt ? Date.parse(dto.readyAt) : entry.readyAt,
          meta: dto.status === 'READY' ? dto : entry.meta,
          error: null,
        }))
      },
      onError: (error) => {
        patchClip(clipId, (entry) => ({ ...entry, error }))
      },
    })

    pollers.set(clipId, stop)
  }

  // --- 분석 -----------------------------------------------------------------

  /**
   * 분석 요청.
   * @param {string} clipId
   * @param {{initFrameIndex:number, targetBbox:[number,number,number,number]}} payload
   */
  async function requestAnalysis(clipId, payload) {
    patchClip(clipId, (entry) => ({
      ...entry,
      analysisError: null,
      // 202 응답을 기다리는 동안에도 ANALYZING 화면이 보이도록 먼저 넣는다.
      analysis: { status: 'PENDING', analysisId: null, request: payload },
    }))

    try {
      const created = await createAnalysis(clipId, payload)
      patchClip(clipId, (entry) => ({
        ...entry,
        analysis: { ...entry.analysis, ...created },
      }))
      watchAnalysis(clipId, created.analysisId)
    } catch (error) {
      patchClip(clipId, (entry) => ({ ...entry, analysis: null, analysisError: error }))
      throw error
    }
  }

  function watchAnalysis(clipId, analysisId) {
    stopPoller(analysisId)

    const stop = startPolling(() => fetchAnalysis(analysisId), {
      intervalMs: POLL_INTERVAL_MS,
      isDone: (dto) => dto.status === 'DONE' || dto.status === 'FAILED',
      onResult: (dto) => {
        patchClip(clipId, (entry) => ({
          ...entry,
          analysis: { ...entry.analysis, ...dto },
        }))
      },
      onError: (error) => {
        patchClip(clipId, (entry) => ({ ...entry, analysisError: error }))
      },
    })

    pollers.set(analysisId, stop)
  }

  /** 같은 클립에 박스를 다시 그려 재분석. 결과를 지우면 화면은 CLIP_READY 로 돌아간다. */
  function resetAnalysis(clipId) {
    const entry = clips.value.find((clip) => clip.clipId === clipId)
    if (entry?.analysis?.analysisId) stopPoller(entry.analysis.analysisId)
    patchClip(clipId, (clip) => ({ ...clip, analysis: null, analysisError: null }))
  }

  // --- 선택 -----------------------------------------------------------------

  function select(clipId) {
    selectedClipId.value = clipId
  }

  /** 패널 비우기. 큐에서 지우지는 않는다 — 나중에 다시 고를 수 있어야 한다. */
  function clearSelection() {
    selectedClipId.value = null
  }

  function dismiss(clipId) {
    stopPoller(clipId)
    const entry = clips.value.find((clip) => clip.clipId === clipId)
    if (entry?.analysis?.analysisId) stopPoller(entry.analysis.analysisId)
    clips.value = clips.value.filter((clip) => clip.clipId !== clipId)
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  // --- 내부 -----------------------------------------------------------------

  function patchClip(clipId, updater) {
    clips.value = clips.value.map((clip) => (clip.clipId === clipId ? updater(clip) : clip))
  }

  function stopPoller(key) {
    const stop = pollers.get(key)
    if (stop) {
      stop()
      pollers.delete(key)
    }
  }

  // 컴포넌트가 사라질 때 타이머를 반드시 정리한다. 안 그러면 로그아웃 후에도
  // 폴링이 계속 돌면서 401 을 유발한다.
  onScopeDispose(() => {
    pollers.forEach((stop) => stop())
    pollers.clear()
  })

  return {
    clips,
    selectedClip,
    selectedClipId,
    screenState,
    pendingCount,
    triggering,
    triggerError,
    trigger,
    requestAnalysis,
    resetAnalysis,
    select,
    clearSelection,
    dismiss,
  }
}

/**
 * @typedef {object} ClipEntry
 * @property {string} clipId
 * @property {'PENDING'|'READY'|'FAILED'} status
 * @property {number|null} readyAt      epoch ms. 남은 시간 표시에 쓴다
 * @property {number} triggeredAt
 * @property {object|null} meta         READY 일 때의 클립 메타데이터 (fps/width/height...)
 * @property {object|null} analysis
 * @property {any} analysisError
 * @property {any} error
 */
