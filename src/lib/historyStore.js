/**
 * 검출 기록 저장소.
 *
 * 백엔드에 `GET /api/analyses` 가 아직 없어서 브라우저(localStorage)에 남긴다.
 * 그래서 한계가 분명하다. 적어두는 이유는 나중에 이걸 잊고 "기록이 왜 없지"
 * 하지 않기 위해서다.
 *
 *   - 이 브라우저에만 남는다. 다른 PC 나 다른 계정에서는 안 보인다
 *   - 방문 기록을 지우면 같이 사라진다
 *   - 오버레이 영상은 AI 서버의 임시 파일을 가리킨다. AI 를 재시작하거나
 *     artifacts 를 비우면 링크가 깨진다 (썸네일은 남는다)
 *
 * 백엔드가 이력 API 를 열면 이 파일을 그 호출로 바꾸면 된다. 화면(HistoryView)은
 * 여기서 주는 모양만 보므로 컴포넌트는 안 고쳐도 된다.
 */

const STORAGE_KEY = 'skydetect.history.v1'
/** 썸네일이 있어서 무한정 쌓으면 localStorage 한도(보통 5MB)에 걸린다. */
const MAX_ENTRIES = 40

/** @returns {HistoryEntry[]} 최신이 앞 */
export function listHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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
 * @param {object|null} entry.topFeatures
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

export function removeHistory(id) {
  persist(listHistory().filter((entry) => entry.id !== id))
}

export function clearHistory() {
  persist([])
}

function persist(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // 용량이 찼을 때. 썸네일을 버리고 다시 시도한다. 기록 자체는 살린다.
    try {
      const light = entries.map((entry) => ({ ...entry, thumbnail: null }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(light))
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
