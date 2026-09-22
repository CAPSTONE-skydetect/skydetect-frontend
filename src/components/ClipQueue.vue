<script setup>
/**
 * 클립 큐.
 *
 * 오른쪽 패널은 하나뿐인데 클립은 동시에 여러 개가 PENDING 일 수 있다.
 * 큐가 없으면 두 번째 검출이 첫 번째를 덮어쓰거나, 결과를 읽는 중에 새 클립이
 * 화면을 가로챈다. 그래서 진행 중인 클립을 전부 여기 늘어놓고 패널에 무엇을
 * 띄울지는 사용자가 고른다. 끝난 클립은 결과 라벨을 달고 남아 이력 역할도 한다.
 */
import { computed } from 'vue'

const props = defineProps({
  session: { type: Object, required: true },
})

const clips = computed(() => props.session.clips.value)

const LABEL_TEXT = { bird: '새', drone: '드론', uncertain: '판단불가' }

function statusOf(clip) {
  if (clip.status === 'PENDING') return { text: '저장 중', tone: 'warn', pulse: true }
  if (clip.status === 'FAILED') return { text: '실패', tone: 'error', pulse: false }

  const analysis = clip.analysis
  if (!analysis) return { text: '준비됨', tone: 'ok', pulse: false }
  if (analysis.status === 'DONE') {
    return { text: LABEL_TEXT[analysis.label] || analysis.label, tone: toneFor(analysis.label), pulse: false }
  }
  if (analysis.status === 'FAILED') return { text: '분석 실패', tone: 'error', pulse: false }
  return { text: '분석 중', tone: 'warn', pulse: true }
}

function toneFor(label) {
  if (label === 'bird') return 'ok'
  if (label === 'drone') return 'error'
  return 'warn'
}

function timeOf(clip) {
  const date = new Date(clip.triggeredAt)
  const pad = (n) => String(n).padStart(2, '0')
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}
</script>

<template>
  <section class="panel queue">
    <div class="panel__head">
      <span class="panel__title">클립 큐</span>
      <span class="faint">{{ clips.length }}건</span>
      <div style="flex: 1" />
    </div>

    <div class="queue__list">
      <p v-if="!clips.length" class="faint queue__empty">비어 있음</p>

      <button
        v-for="clip in clips"
        :key="clip.clipId"
        class="queue__item"
        :class="{ 'queue__item--active': clip.clipId === session.selectedClipId.value }"
        @click="session.select(clip.clipId)"
      >
        <span class="badge" :class="'badge--' + statusOf(clip).tone">
          <span class="dot" :class="{ 'dot--pulse': statusOf(clip).pulse }" />
          {{ statusOf(clip).text }}
        </span>
        <span class="mono queue__time">{{ timeOf(clip) }}</span>
        <span
          class="queue__dismiss"
          title="큐에서 제거"
          @click.stop="session.dismiss(clip.clipId)"
        >✕</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.queue { flex: none; }
.queue__hint { font-size: 11px; }
.queue__list {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  min-height: 58px;
  align-items: center;
}
.queue__empty { margin: 0; font-size: 12px; }
.queue__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  white-space: nowrap;
  flex: none;
}
.queue__item--active {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.queue__time { font-size: 11px; color: var(--text-faint); }
.queue__dismiss {
  color: var(--text-faint);
  padding: 0 2px;
  border-radius: 4px;
}
.queue__dismiss:hover { color: var(--danger); }
</style>
