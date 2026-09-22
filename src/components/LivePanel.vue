<script setup>
/**
 * 왼쪽 패널 — 라이브 스트림.
 *
 * 이 패널의 규칙은 하나다: **무슨 일이 있어도 멈추지 않는다.**
 * 오른쪽에서 클립을 기다리든 분석이 돌든, 왼쪽은 계속 흘러야 하고
 * 트리거 버튼도 계속 눌려야 한다 (여러 클립이 동시에 PENDING 일 수 있다).
 * 그래서 트리거 버튼의 disabled 는 "요청을 보내는 순간"에만 걸린다.
 */
import { ref } from 'vue'
import { useHls } from '../composables/useHls.js'
import { HLS_URL } from '../api/config.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const videoEl = ref(null)
const source = ref(HLS_URL)
const { status, error, engine, retry, resume } = useHls(videoEl, source)

async function onTrigger() {
  try {
    await props.session.trigger()
  } catch {
    // 에러는 session.triggerError 로 화면에 뜬다. 여기서 다시 던지지 않는다.
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <span class="panel__title">라이브</span>

      <span v-if="status === 'playing'" class="badge badge--live">
        <span class="dot dot--pulse" />LIVE
      </span>
      <span v-else-if="status === 'loading'" class="badge">
        <span class="dot dot--pulse" />연결 중
      </span>
      <span v-else-if="status === 'paused' || status === 'blocked'" class="badge badge--warn">
        <span class="dot" />일시정지
      </span>
      <span v-else-if="status === 'error'" class="badge badge--error">
        <span class="dot" />스트림 끊김
      </span>

      <div style="flex: 1" />
      <span class="faint mono live__engine">{{ engine }}</span>
    </div>

    <div class="panel__body">
      <div class="live__stage">
        <!-- muted 없으면 브라우저 자동재생 정책에 막힌다. 관제 영상에 소리는 필요 없다. -->
        <video ref="videoEl" class="live__video" muted playsinline loop autoplay />

        <!-- 멈춤과 고장을 구분해서 보여준다.
             탭을 백그라운드로 보내면 브라우저가 무음 영상을 절전 정지시키는데,
             그걸 "스트림 오류"로 그리면 멀쩡한 서버를 의심하게 된다. -->
        <div v-if="status === 'paused' || status === 'blocked'" class="live__overlay">
          <p class="dim">{{ error?.message || '재생이 멈췄다.' }}</p>
          <button @click="resume">재생</button>
        </div>

        <div v-else-if="status === 'error'" class="live__overlay">
          <p>{{ error?.message }}</p>
          <p class="faint mono live__src">{{ source }}</p>
          <button @click="retry">다시 연결</button>
        </div>
      </div>

      <div class="live__controls">
        <button class="live__trigger" :disabled="session.triggering.value" @click="onTrigger">
          <span v-if="session.triggering.value" class="spinner" />
          <span v-else class="live__trigger-dot" />
          검출 트리거
        </button>

        <div class="live__hint">
          <p class="dim">
            누른 시각 기준 <b>-3초 ~ +10초</b> 구간을 잘라낸다.
          </p>
          <p class="faint">
            +10초는 아직 오지 않은 시간이라, 클립이 뜨기까지 최소 10초가 걸린다.
            기다리는 동안에도 계속 눌러도 된다.
          </p>
        </div>

        <div style="flex: 1" />

        <span v-if="session.pendingCount.value > 0" class="badge badge--warn">
          <span class="dot dot--pulse" />저장 중 {{ session.pendingCount.value }}건
        </span>
      </div>

      <p v-if="session.triggerError.value" class="live__error">
        트리거 실패: {{ session.triggerError.value.message }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.live__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #05080c;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.live__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.live__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #05080ccc;
  text-align: center;
  padding: 20px;
}
.live__overlay p { margin: 0; }
.live__src { font-size: 12px; word-break: break-all; }
.live__engine { font-size: 11px; }

.live__controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}
.live__trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  padding: 11px 18px;
  background: #7f1d1d;
  border-color: #b91c1c;
  white-space: nowrap;
}
.live__trigger:hover:not(:disabled) { background: #991b1b; border-color: #ef4444; }
.live__trigger-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #fca5a5;
  box-shadow: 0 0 0 3px #fca5a533;
}
.live__hint p { margin: 0; font-size: 12px; }
.live__error {
  margin: 0;
  padding: 10px 14px;
  color: var(--danger);
  font-size: 13px;
  border-top: 1px solid var(--border);
}
</style>
