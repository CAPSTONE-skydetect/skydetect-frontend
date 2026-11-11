<script setup>
/**
 * 로그인 이후의 공통 껍데기. 헤더(화면 전환 + 연결 상태 + 계정)와 본문 자리.
 *
 * 라우터를 쓰지 않으므로 전환은 해시로 한다 (#/live, #/upload, #/history).
 * 라이브러리 없이도 새로고침과 뒤로가기가 동작한다.
 *
 * 언어 전환(EN / 한국어)도 여기서 한다. 화면 문구는 한국어로 쓰여 있고, 영어를 고르면
 * lib/domTranslate 가 화면에 그려진 한국어 문구를 영어로 바꿔 보여 준다.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useLocale } from '../composables/useLocale.js'
import { startDomTranslate } from '../lib/domTranslate.js'
import DroneMark from './DroneMark.vue'
import { fetchHealth } from '../api/ai.js'
import { AI_MODELS, aiModel } from '../lib/aiModel.js'

defineProps({
  view: { type: String, required: true },
})

const emit = defineEmits(['change', 'home'])

const { user, logout } = useAuth()
const { isKo, setLocale, t } = useLocale()

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
let stopTranslate = null

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
  stopTranslate = startDomTranslate(document.getElementById('app'))
})
onBeforeUnmount(() => {
  clearInterval(probeTimer)
  stopTranslate?.()
})
</script>

<template>
  <div class="shell">
    <header class="top">
      <!-- 로고를 누르면 시작 화면(소개 + 파트 선택)으로 돌아간다. -->
      <button type="button" class="top__brand" title="시작 화면" @click="emit('home')">
        <span class="top__tile"><DroneMark :size="20" /></span>
        <span class="top__name">SkyDetect</span>
      </button>

      <nav class="tabs" aria-label="화면">
        <button
          v-for="item in VIEWS"
          :key="item.key"
          class="tabs__item"
          :class="{ 'tabs__item--on': view === item.key }"
          :aria-current="view === item.key ? 'page' : undefined"
          @click="emit('change', item.key)"
        >{{ item.label }}</button>
      </nav>

      <div class="top__spacer" />

      <!-- 판정 모델 토글. 다음 분석부터 적용된다. -->
      <div class="top__group">
        <span class="top__label">판정 모델</span>
        <div class="seg" title="다음 분석부터 적용">
          <button
            v-for="item in AI_MODELS"
            :key="item.key"
            class="seg__item"
            :class="{ 'seg__item--on': aiModel === item.key }"
            @click="aiModel = item.key"
          >{{ item.label }}</button>
        </div>
      </div>

      <span
        class="top__status"
        :class="{ 'top__status--ok': aiOnline === true, 'top__status--error': aiOnline === false }"
        :title="`${AI_MODELS[aiModel].label} AI 서버 ${aiOnline ? '연결됨' : '응답 없음'} (${AI_MODELS[aiModel].base})`"
      >
        <span class="dot" />
        {{ aiOnline === null ? 'AI 확인 중' : aiOnline ? 'AI' : 'AI 응답 없음' }}
      </span>

      <div class="seg lang" role="group" :aria-label="t('lang.switch')">
        <button class="seg__item" :class="{ 'seg__item--on': !isKo }" :aria-pressed="!isKo" @click="setLocale('en')">EN</button>
        <button class="seg__item" :class="{ 'seg__item--on': isKo }" :aria-pressed="isKo" @click="setLocale('ko')">한국어</button>
      </div>

      <div class="top__user">
        <span class="mono">{{ user.username }}</span>
        <button class="btn-ghost btn-sm" @click="logout">로그아웃</button>
      </div>
    </header>

    <div class="shell__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.top {
  flex: none;
  height: 48px;
  display: flex;
  align-items: stretch;
  gap: 20px;
  padding: 0 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.top > * { display: flex; align-items: center; }
.top__brand {
  gap: 10px;
  height: auto;
  padding: 0 4px 0 0;
  border: none;
  background: transparent;
  color: var(--text);
}
.top__brand:hover:not(:disabled) { background: transparent; }
/* 회색 평면 타일 안에 드론 마크. 색은 없고, 강조색은 쓰지 않는다. */
.top__tile {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  color: #e8edf3;
  background: #2a3038;
  border: 1px solid #3d4651;
}
.top__name { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
.top__spacer { flex: 1; }

/* 화면 전환. 선택된 탭은 아래 2px 선으로만 표시한다. */
.tabs { gap: 2px; }
.tabs__item {
  height: 100%;
  border: none;
  border-radius: 0;
  padding: 0 14px;
  font-size: 13px;
  color: var(--text-dim);
  background: transparent;
  position: relative;
}
.tabs__item:hover:not(:disabled) { background: transparent; color: var(--text); }
.tabs__item--on { color: var(--text); font-weight: 600; }
.tabs__item--on::after {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
}

.top__group { gap: 8px; }
.top__label { font-size: 12px; color: var(--text-faint); }

.seg {
  align-self: center;
  display: flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--radius);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.seg__item {
  height: 22px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-dim);
}
.seg__item:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.seg__item--on,
.seg__item--on:hover:not(:disabled) { background: var(--border-strong); color: var(--text); font-weight: 600; }

.top__status { gap: 6px; font-size: 12px; color: var(--text-faint); }
/* 연결 상태도 판정이 아니므로 중립색 글자에 강조색 점으로만 알린다. */
.top__status--ok { color: var(--text-dim); }
.top__status--ok .dot { color: var(--accent); }
.top__status--error { color: var(--danger); }

.top__user {
  gap: 8px;
  padding-left: 16px;
  border-left: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-dim);
}

/* 화면 본문. 패널 사이 1px 틈으로 바탕이 비쳐 칸막이가 된다. */
.shell__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

@media (max-width: 1100px) {
  .shell { height: auto; min-height: 100%; }
  .top { gap: 12px; padding: 0 12px; }
  .top__label { display: none; }
}
</style>
