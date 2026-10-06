/**
 * 판정 모델 선택 (RF / MiniRocket).
 *
 * 두 모델은 AI 저장소의 서로 다른 브랜치(model/rf, model/minirocket)라 서버도 따로 뜬다.
 * 프록시 접두어로 구분한다 (vite.config.js, nginx.conf 와 짝이다).
 *   /ai/...            -> RF 서버
 *   /ai-minirocket/... -> MiniRocket 서버
 *
 * 선택값은 이 브라우저에만 기억한다. 화면 편의용이라 서버에 남길 이유가 없다.
 */
import { ref, watch } from 'vue'

export const AI_MODELS = {
  rf: { key: 'rf', label: 'RF', base: '/ai' },
  minirocket: { key: 'minirocket', label: 'MiniRocket', base: '/ai-minirocket' },
}

const STORAGE_KEY = 'skydetect.aiModel'

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return AI_MODELS[value] ? value : 'rf'
  } catch {
    return 'rf'
  }
}

/** 지금 선택된 모델 키 */
export const aiModel = ref(readStored())

watch(aiModel, (value) => {
  try { localStorage.setItem(STORAGE_KEY, value) } catch { /* 저장 실패해도 선택은 유지된다 */ }
})

/** 모델 키 → 프록시 접두어. 모르는 값이면 RF 로 본다. */
export function aiBase(model = aiModel.value) {
  return (AI_MODELS[model] || AI_MODELS.rf).base
}

export function modelLabel(model) {
  return AI_MODELS[model]?.label || model || '-'
}
