<script setup>
/**
 * 판단 근거. 모델이 왜 새/드론(또는 판단불가)으로 판정했는지 보여준다.
 *
 * 시계열 모델은 2초 창마다 판정 점수를 내고, 창 점수의 평균 부호로 판정한다.
 * 색만으로 방향을 말하지 않도록 막대 옆에 "드론 / 새" 과 부호 있는 숫자를 함께 쓴다.
 */
import { computed } from 'vue'

const props = defineProps({
  analysis: { type: Object, required: true },
})

const WINDOW_REJECTION = {
  short_track: '궤적이 2초 미만',
  long_gap: '긴 추적 끊김',
  missing_fraction: '결측 비율 초과',
  resampling_support: '보간할 관측 부족',
}

const windows = computed(() => {
  const scores = props.analysis.windowScores || []
  const starts = props.analysis.windowStartsS || []
  const offset = props.analysis.trackStartS
  const maxAbs = Math.max(...scores.filter(Number.isFinite).map((s) => Math.abs(s)), 1e-9)
  return scores.flatMap((score, i) => {
    if (!Number.isFinite(score)) return []
    const start = Number.isFinite(offset) && Number.isFinite(starts[i]) ? offset + starts[i] : null
    return [{
      score,
      height: (Math.abs(score) / maxAbs) * 100,
      label: start != null ? `${start.toFixed(1)}–${(start + 2).toFixed(1)}초` : `창 ${i + 1}`,
    }]
  })
})

const droneWindows = computed(() => windows.value.filter((w) => w.score > 0).length)
const birdWindows = computed(() => windows.value.filter((w) => w.score < 0).length)
const neutralWindows = computed(() => windows.value.filter((w) => w.score === 0).length)

const rejectionText = computed(() => {
  const r = props.analysis.windowRejections || {}
  return Object.entries(r).map(([k, n]) => `${WINDOW_REJECTION[k] || k} ${n}개`).join(' · ')
})

function signed(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '-'
  return (value > 0 ? '+' : '') + value.toFixed(digits)
}

</script>

<template>
  <div class="evidence">
    <p v-if="!windows.length" class="faint evidence__empty">
      <template v-if="analysis.windowsUsed === 0">판정에 쓸 2초 창이 없습니다.</template>
      <template v-else>이 결과에는 구간별 점수 정보가 없습니다.</template>
      <template v-if="rejectionText"> 제외된 창: {{ rejectionText }}</template>
    </p>

    <template v-else>
      <p class="evidence__formula mono">
        평균 점수 {{ signed(analysis.decisionScore) }}
        = 창 {{ windows.length }}개 점수의 평균
      </p>
      <p class="evidence__verdict">
        드론 창 {{ droneWindows }}개, 새 창 {{ birdWindows }}개.
        <template v-if="neutralWindows">경계 창 {{ neutralWindows }}개.</template>
        <template v-if="analysis.label === 'uncertain'">서버의 보류 기준에 따라 최종 판정을 보류했습니다.</template>
        <template v-else>최종 판정은 {{ analysis.label === 'drone' ? '드론' : '새' }}입니다. 점수 평균으로 결정하며 다수결이 아닙니다.</template>
      </p>

      <div class="mr">
        <div class="mr__axis faint"><span>드론 ↑</span><span>새 ↓</span></div>
        <div class="mr__chart">
          <div v-for="(w, i) in windows" :key="i" class="mr__col" :title="`${w.label} · 점수 ${signed(w.score)}`">
            <span class="mr__num mono">{{ signed(w.score, 1) }}</span>
            <div class="mr__up">
              <div v-if="w.score >= 0" class="mr__fill mr__fill--drone" :style="{ height: w.height + '%' }" />
            </div>
            <div class="mr__down">
              <div v-if="w.score < 0" class="mr__fill mr__fill--bird" :style="{ height: w.height + '%' }" />
            </div>
            <span class="mr__label faint">{{ w.label }}</span>
          </div>
        </div>
      </div>
      <p v-if="rejectionText" class="faint evidence__note">판정에서 제외된 창: {{ rejectionText }}</p>
      <p class="faint evidence__note">
        2초 구간을 1초씩 밀어가며 잘라 구간마다 판정 점수를 냅니다. 확률이 아니라 방향과 세기입니다.
      </p>
    </template>
  </div>
</template>

<style scoped>
.evidence {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}
.evidence__formula { margin: 0; font-size: 13px; font-weight: 600; }
.evidence__verdict { margin: 0; font-size: 12px; }
.evidence__note, .evidence__empty { margin: 0; font-size: 12px; line-height: 1.5; }
.mr { display: flex; gap: 8px; }
.mr__axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 12px; padding: 18px 0 22px; }
.mr__chart { flex: 1; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.mr__col { flex: 1; min-width: 44px; display: flex; flex-direction: column; align-items: stretch; }
.mr__num { text-align: center; font-size: 12px; height: 16px; }
.mr__up, .mr__down { height: 46px; display: flex; justify-content: center; }
.mr__up { align-items: flex-end; border-bottom: 1px solid var(--border-strong); }
.mr__down { align-items: flex-start; }
.mr__fill { width: 60%; border-radius: 1px; }
.mr__fill--drone { background: var(--drone); }
.mr__fill--bird { background: var(--bird); }
.mr__label { text-align: center; font-size: 12px; margin-top: 4px; white-space: nowrap; }
</style>
