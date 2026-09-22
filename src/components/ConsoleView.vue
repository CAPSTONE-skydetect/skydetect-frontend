<script setup>
/**
 * 실시간 관제 화면.
 *
 *   ┌ 왼쪽: 라이브 │ 오른쪽: 클립 ┐
 *   │              │ ─────────────│
 *   │              │ 클립 큐      │
 *   └─────────────────────────────┘
 *
 * 상태(useClipSession)는 여기서 한 번만 만들어 양쪽에 내려준다. 검출 버튼은
 * 왼쪽에 있고 결과는 오른쪽에 뜨므로 두 패널이 같은 상태를 봐야 한다.
 *
 * 헤더는 AppShell 이 그린다.
 */
import { useClipSession } from '../composables/useClipSession.js'
import LivePanel from './LivePanel.vue'
import ClipPanel from './ClipPanel.vue'
import ClipQueue from './ClipQueue.vue'

const session = useClipSession()
</script>

<template>
  <main class="console">
    <LivePanel :session="session" />

    <div class="console__right">
      <ClipPanel :session="session" />
      <ClipQueue :session="session" />
    </div>
  </main>
</template>

<style scoped>
/* 한쪽이 커져도 다른 쪽을 밀지 않도록 minmax(0, 1fr) 을 쓴다. */
.console {
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
  .console {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: min-content;
  }
  .console > *, .console__right > * { min-height: 360px; }
  .console__right > :last-child { min-height: 0; }
}
</style>
