<script setup>
import { computed } from 'vue'
import { scoreShare } from '../lib/scoreShare.js'
const props = defineProps({ analysis: { type: Object, required: true } })
const share = computed(() => scoreShare(props.analysis.windowScores))
const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumSignificantDigits: 4 }) : '범위 초과'
</script>

<template>
  <section class="score-share" aria-label="구간 점수 비중">
    <h3>구간 점수 비중</h3>
    <template v-if="share">
      <div class="score-share__labels">
        <strong class="score-share__drone">드론 {{ share.dronePercent }}%</strong>
        <strong class="score-share__bird">새 {{ share.birdPercent }}%</strong>
      </div>
      <div class="score-share__bar" role="img" :aria-label="`드론 ${share.dronePercent}%, 새 ${share.birdPercent}%`">
        <span :style="{ width: share.dronePercent + '%' }" />
      </div>
      <p class="dim">드론 점수 합계 {{ format(share.droneSum) }} · 새 점수 합계 {{ format(share.birdSum) }}</p>
      <p class="faint">구간 점수의 크기를 합산한 비중입니다. 분류 확률과는 다릅니다.</p>
    </template>
    <p v-else class="dim">구간 점수 비중을 계산할 수 없습니다. 유효한 구간 점수가 필요합니다.</p>
  </section>
</template>

<style scoped>
.score-share { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; gap: 12px; }
h3, p { margin: 0; }
h3 { font-size: 14px; }
p { font-size: 12px; line-height: 1.6; }
.score-share__labels { display: flex; justify-content: space-between; gap: 16px; font-size: 22px; }
.score-share__drone { color: var(--drone); }
.score-share__bird { color: var(--bird); }
.score-share__bar { height: 20px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bird); }
.score-share__bar span { display: block; height: 100%; background: var(--drone); }
</style>
