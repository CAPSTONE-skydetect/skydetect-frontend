<script setup>
/**
 * 로그인 이후의 공통 껍데기. 헤더(화면 전환 + 연결 상태 + 계정)와 본문 자리.
 *
 * 라우터를 쓰지 않으므로 전환은 해시로 한다 (#/live, #/upload, #/history).
 * 라이브러리 없이도 새로고침과 뒤로가기가 동작한다.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { fetchHealth } from '../api/ai.js'
import { AI_MODELS, aiModel } from '../lib/aiModel.js'

defineProps({
  view: { type: String, required: true },
})

const emit = defineEmits(['change'])

const { user, logout } = useAuth()

const VIEWS = [
  { key: 'live', label: '실시간' },
  { key: 'upload', label: '업로드 분석' },
  { key: 'history', label: '검출 기록' },
]

/**
 * 선택한 판정 모델의 AI 서버가 떠 있는지.
 * 백엔드는 로그인되어 있다는 것 자체가 살아있다는 증거다.
 */
const aiOnline = ref(null)
let probeTimer = null

async function probeAi() {
  const model = aiModel.value
  try {
    await fetchHealth()
    if (model === aiModel.value) aiOnline.value = true
  } catch {
    if (model === aiModel.value) aiOnline.value = false
  }
}

// 모델을 바꾸면 그 서버 상태를 바로 다시 본다.
watch(aiModel, () => {
  aiOnline.value = null
  probeAi()
})

onMounted(() => {
  probeAi()
  probeTimer = setInterval(probeAi, 15_000)
})
onBeforeUnmount(() => clearInterval(probeTimer))
</script>

<template>
  <div class="shell">
    <header class="shell__head">
      <span class="shell__mark">SkyDetect</span>

      <nav class="nav">
        <button
          v-for="item in VIEWS"
          :key="item.key"
          class="nav__item"
          :class="{ 'nav__item--on': view === item.key }"
          @click="emit('change', item.key)"
        >{{ item.label }}</button>
      </nav>

      <div class="shell__spacer" />

      <!-- 판정 모델 토글. 다음 분석부터 적용된다. -->
      <nav class="nav" title="판정 모델 (다음 분석부터 적용)">
        <button
          v-for="item in AI_MODELS"
          :key="item.key"
          class="nav__item"
          :class="{ 'nav__item--on': aiModel === item.key }"
          @click="aiModel = item.key"
        >{{ item.label }}</button>
      </nav>

      <span
        class="badge"
        :class="{ 'badge--ok': aiOnline === true, 'badge--error': aiOnline === false }"
        :title="`${AI_MODELS[aiModel].label} AI 서버 ${aiOnline ? '연결됨' : '응답 없음'} (${AI_MODELS[aiModel].base})`"
      >
        <span class="dot" />AI
      </span>

      <span class="badge">
        <span class="dot" style="color: var(--bird)" />{{ user.username }}
      </span>
      <button @click="logout">로그아웃</button>
    </header>

    <slot />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
}
.shell__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.shell__mark { font-size: 16px; font-weight: 700; }
.shell__spacer { flex: 1; }

/* 화면 전환 토글 */
.nav {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
}
.nav__item {
  padding: 5px 14px;
  font-size: 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  border-radius: 7px;
}
.nav__item:hover:not(.nav__item--on) { background: var(--bg-elevated); color: var(--text); }
.nav__item--on {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .shell { height: auto; min-height: 100%; }
}
</style>
