/**
 * 판정 모델 서버.
 *
 * 판정은 궤적 시계열 모델 서버 하나로 보낸다 (기본 MultiRocket Stack, 설정에 따라 MiniRocket).
 * 프록시 접두어는 vite.config.js, nginx.conf 와 짝이다.
 *   /ai-minirocket/... -> 시계열 모델 서버
 *
 * 예전에는 RF / MiniRocket 을 화면에서 골랐다. 그때 브라우저에 남은 선택값은 지운다.
 */
import { ref } from 'vue'

const BASE = '/ai-minirocket'

const LABELS = {
  minirocket: 'MiniRocket',
  multirocket: 'MultiRocket Stack',
}

try { localStorage.removeItem('skydetect.aiModel') } catch { /* 저장소를 못 써도 동작에는 상관없다 */ }

/** 서버 응답에 model 이 없을 때 쓰는 이름. 실제 이름은 응답의 model 필드를 따른다. */
export const aiModel = ref('multirocket')

/** AI 서버 프록시 접두어. 서버가 하나라 인자는 무시한다 (기존 호출부 호환). */
export function aiBase() {
  return BASE
}

export function modelLabel(model) {
  return LABELS[model] || model || '-'
}
