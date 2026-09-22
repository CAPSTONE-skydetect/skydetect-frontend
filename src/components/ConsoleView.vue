<script setup>
/**
 * 관제 화면. 페이지 이동이 없는 단일 화면이다.
 *
 * 레이아웃
 *   ┌ 헤더 ────────────────────────────────────────┐
 *   ├ 왼쪽: 라이브(계속 재생) │ 오른쪽: 클립(정지) ┤
 *   │                        │ ───────────────────│
 *   │                        │ 클립 큐            │
 *   └──────────────────────────────────────────────┘
 *
 * 상태(useClipSession)는 여기서 한 번만 만들고 양쪽에 내려준다.
 * 트리거 버튼은 왼쪽(라이브)에 있고 결과는 오른쪽에 뜨므로, 두 패널이
 * 같은 상태를 봐야 한다.
 */
import { useAuth } from '../composables/useAuth.js'
import { useClipSession } from '../composables/useClipSession.js'
import { USE_MOCK } from '../api/config.js'
import LivePanel from './LivePanel.vue'
import ClipPanel from './ClipPanel.vue'
import ClipQueue from './ClipQueue.vue'

const { user, logout } = useAuth()
const session = useClipSession()
</script>

<template>
  <div class="console">
    <header class="console__head">
      <div class="console__brand">
        <span class="console__mark">SkyDetect</span>
        <span class="faint">관제 콘솔</span>
      </div>

      <span v-if="USE_MOCK" class="badge badge--warn" title="클립·분석 API 는 아직 백엔드에 없다">
        MOCK 모드 · 클립/분석
      </span>

      <div class="console__spacer" />

      <span class="badge">
        <span class="dot" style="color: var(--bird)" />
        {{ user.username }}
        <span class="faint">{{ user.role?.replace('ROLE_', '') }}</span>
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
  gap: 10px;
  flex: none;
}
.console__brand { display: flex; align-items: baseline; gap: 8px; }
.console__mark { font-size: 16px; font-weight: 700; }
.console__spacer { flex: 1; }

/* 좌우 2분할. 한쪽이 커져도 다른 쪽을 밀지 않도록 minmax(0, 1fr) 를 쓴다. */
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

/* 관제실은 넓은 화면을 쓰지만, 좁은 창에서 패널이 겹쳐 깨지지는 않게 한다.
   높이를 100% 로 묶은 채 세로로 쌓으면 각 패널이 납작해져서 영상이 거의 사라진다.
   그래서 이 폭 아래에서는 높이 고정을 풀고 스크롤을 허용한다. */
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
