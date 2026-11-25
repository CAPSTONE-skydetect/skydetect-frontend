/** 분석 직후의 브라우저 기록과 사용자가 서버에 저장한 관측 기록의 로컬 사본.
 * 서버 관측 기록은 HistoryView에서 조회·병합하고 브라우저 기록은 사용자별로 보관한다.
 * 기존 브라우저 기록도 읽을 수 있으며, 영상 산출물 링크의 수명은 AI 서버에 따른다.
 */
import { useAuth } from '../composables/useAuth.js'

const STORAGE_KEY = 'skydetect.history.v1'
/** 썸네일이 있어서 무한정 쌓으면 localStorage 한도(보통 5MB)에 걸린다. */
const MAX_ENTRIES = 40
const storageKey = () => `${STORAGE_KEY}.${encodeURIComponent(useAuth().user.value?.username || 'anonymous')}`

/** @returns {HistoryEntry[]} 최신이 앞 */
export function listHistory() {
  try {
    const raw = localStorage.getItem(storageKey()) || localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // 형식이 깨졌으면 조용히 비운다. 기록 때문에 앱이 안 뜨면 안 된다.
    return []
  }
}

/**
 * 기록 추가.
 * @param {object} entry
 * @param {'live'|'upload'} entry.source
 * @param {string} entry.title        클립 id 또는 파일명
 * @param {string} entry.label        bird | drone | uncertain
 * @param {number} entry.confidence
 * @param {string|null} entry.rejectReason
 * @param {number[]} entry.bbox
 * @param {number} entry.initFrameIndex
 * @param {object|null} entry.quality
 * @param {object|null} entry.metrics
 * @param {object|null} entry.tuning
 * @param {string|null} entry.thumbnail   data URL
 * @param {string|null} entry.overlayUrl
 */
export function addHistory(entry) {
  const record = {
    id: `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    ...entry,
  }

  const next = [record, ...listHistory()].slice(0, MAX_ENTRIES)
  persist(next)
  return record
}

/** 서버 저장 결과로 기존 브라우저 기록을 갱신한다. */
export function updateHistory(record) {
  const entries = listHistory()
  const index = entries.findIndex(entry => entry.id === record.id)
  if (index >= 0) entries[index] = record
  else entries.unshift(record)
  persist(entries.slice(0, MAX_ENTRIES))
}

/**
 * 기록에 남길 판단 근거 필드. 결과 화면(DecisionEvidence)이 읽는 이름 그대로 둔다.
 * 수치 몇 개라 localStorage 용량에는 거의 영향이 없다.
 */
export function evidenceOf(analysis) {
  return {
    decisionScore: analysis.decisionScore ?? null,
    windowScores: analysis.windowScores || null,
    windowStartsS: analysis.windowStartsS || null,
    windowRejections: analysis.windowRejections || null,
    trackStartS: analysis.trackStartS ?? null,
  }
}

export function removeHistory(id) {
  persist(listHistory().filter((entry) => entry.id !== id))
}

export function clearHistory() {
  persist([])
}

function persist(entries) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(entries))
  } catch {
    // 용량이 찼을 때. 썸네일을 버리고 다시 시도한다. 기록 자체는 살린다.
    try {
      const light = entries.map((entry) => ({ ...entry, thumbnail: null }))
      localStorage.setItem(storageKey(), JSON.stringify(light))
    } catch {
      // 그래도 안 되면 포기한다. 저장 실패로 화면이 죽지는 않게 둔다.
    }
  }
}

/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {number} createdAt
 * @property {'live'|'upload'} source
 * @property {string} title
 * @property {string} label
 * @property {number} confidence
 */
