<script setup>
/**
 * 관제 화면. 페이지 이동이 없는 단일 화면이다.
 *
 *   ┌ 헤더 ────────────────────────────────┐
 *   ├ 왼쪽: 라이브 │ 오른쪽: 클립          ┤
 *   │             │ ─────────────────────  │
 *   │             │ 클립 큐                │
 *   └──────────────────────────────────────┘
 *
 * 상태(useClipSession)는 여기서 한 번만 만들어 양쪽에 내려준다. 검출 버튼은
 * 왼쪽에 있고 결과는 오른쪽에 뜨므로 두 패널이 같은 상태를 봐야 한다.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useClipSession } from '../composables/useClipSession.js'
import { CLIP_SOURCE, ANALYSIS_SOURCE } from '../api/config.js'
import { fetchHealth } from '../api/ai.js'
import LivePanel from './LivePanel.vue'
import ClipPanel from './ClipPanel.vue'
import ClipQueue from './ClipQueue.vue'

const { user, logout } = useAuth()
const session = useClipSession()

/**
 * AI 서버가 떠 있는지. 백엔드는 로그인이 되어 있다는 것 자체가 살아있다는 증거라
 * 따로 확인하지 않는다.
 */
const aiOnline = ref(null) // null = 확인 중
let probeTimer = null

async function probeAi() {
  try {
    await fetchHealth()
    aiOnline.value = true
  } catch {
    aiOnline.value = false
  }
}

onMounted(() => {
  probeAi()
  probeTimer = setInterval(probeAi, 15_000)
})
onBeforeUnmount(() => clearInterval(probeTimer))

const SOURCE_LABEL = { mock: 'mock', ai: 'AI 8000', backend: '백엔드' }
</script>

<template>
  <div class="console">
    <header class="console__head">
      <span class="console__mark">SkyDetect</span>

      <span class="badge console__source" :class="{ 'badge--warn': CLIP_SOURCE === 'mock' }">
        클립 {{ SOURCE_LABEL[CLIP_SOURCE] }}
      </span>
      <span class="badge console__source" :class="{ 'badge--warn': ANALYSIS_SOURCE === 'mock' }">
        분석 {{ SOURCE_LABEL[ANALYSIS_SOURCE] }}
      </span>

      <div class="console__spacer" />

      <span
        class="badge"
        :class="{ 'badge--ok': aiOnline === true, 'badge--error': aiOnline === false }"
        :title="aiOnline ? 'AI 서버 연결됨' : 'AI 서버 응답 없음 (localhost:8000)'"
      >
        <span class="dot" />AI
      </span>

      <span class="badge">
        <span class="dot" style="color: var(--bird)" />
        {{ user.username }}
      </span>
      <button @click="logout">로그아웃</button>
    </header>

    <main class="console__split">
      <LivePanel :session="session" />

      <div class="console__right">
        <ClipPanel :session="session" />
        <ClipQueue :session="session" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.console {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
}
.console__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.console__mark { font-size: 16px; font-weight: 700; margin-right: 4px; }
.console__source { font-size: 11px; }
.console__spacer { flex: 1; }

/* 한쪽이 커져도 다른 쪽을 밀지 않도록 minmax(0, 1fr) 을 쓴다. */
.console__split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.console__right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0;
}

/* 좁은 창에서 패널이 겹쳐 깨지지 않게 한다. 높이를 100% 로 묶은 채 세로로 쌓으면
   각 패널이 납작해져 영상이 거의 사라지므로, 높이 고정을 풀고 스크롤을 허용한다. */
@media (max-width: 1100px) {
  .console { height: auto; min-height: 100%; }
  .console__split {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: min-content;
  }
  .console__split > *, .console__right > * { min-height: 360px; }
  .console__right > :last-child { min-height: 0; }
}
</style>
