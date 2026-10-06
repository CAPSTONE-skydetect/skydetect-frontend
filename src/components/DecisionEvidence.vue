<script setup>
/**
 * 판단 근거. 모델이 왜 새/드론(또는 판단불가)으로 판정했는지 보여준다.
 *
 * 모델마다 근거의 모양이 다르다.
 *   RF         이 궤적의 드론 확률 = 기준값 + 피처별 기여 (트리 경로 분해, 합이 정확히 맞는다)
 *   MiniRocket 2초 창마다 Ridge margin. 창 점수의 평균 부호로 판정한다
 *
 * 색만으로 방향을 말하지 않도록 막대 옆에 "드론 쪽 / 새 쪽" 과 부호 있는 숫자를 함께 쓴다.
 */
import { computed } from 'vue'

const props = defineProps({
  analysis: { type: Object, required: true },
})

/** RF 판정 기준 (ai_server/services/classifier.py 의 _CONFIDENCE_THRESHOLD) */
const RF_THRESHOLD = 0.6

const FEATURE_LABEL = {
  speed_median: '속도 중앙값',
  speed_cv: '속도 변동계수',
  acceleration_median: '가속도 중앙값',
  acceleration_p95: '가속도 95분위',
  turn_rate_median: '회전율 중앙값',
  turn_rate_p95: '회전율 95분위',
  curvature_cv: '곡률 변동계수',
  tortuosity: '굴곡도',
  heading_change_ratio: '방향 전환 비율',
}

const WINDOW_REJECTION = {
  short_track: '궤적이 2초 미만',
  long_gap: '긴 추적 끊김',
  missing_fraction: '결측 비율 초과',
  resampling_support: '보간할 관측 부족',
}

const isMiniRocket = computed(() => props.analysis.model === 'minirocket')

// RF ----------------------------------------------------------------------

const contributions = computed(() => props.analysis.featureContributions || null)
const hasRfEvidence = computed(() => !!contributions.value && Object.keys(contributions.value).length > 0)

const rfRows = computed(() => {
  if (!hasRfEvidence.value) return []
  const values = props.analysis.featureValues || {}
  const entries = Object.entries(contributions.value)
  const maxAbs = Math.max(...entries.map(([, c]) => Math.abs(c)), 1e-9)
  return entries
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([name, c]) => ({
      name,
      label: FEATURE_LABEL[name] || name,
      contribution: c,
      value: values[name],
      width: (Math.abs(c) / maxAbs) * 100,
    }))
})

const rfSum = computed(() => rfRows.value.reduce((sum, row) => sum + row.contribution, 0))
const rfBase = computed(() => props.analysis.baseDroneProba)
const droneProba = computed(() => (rfBase.value ?? 0) + rfSum.value)

const rfVerdict = computed(() => {
  const p = droneProba.value
  const top = Math.max(p, 1 - p)
  const side = p >= 0.5 ? '드론' : '새'
  if (top < RF_THRESHOLD) {
    return `더 높은 쪽(${side})의 확률 ${top.toFixed(2)}이 기준 ${RF_THRESHOLD}에 못 미쳐 판정을 보류했습니다.`
  }
  return `${side} 확률 ${top.toFixed(2)}이 기준 ${RF_THRESHOLD} 이상이라 ${side}(으)로 판정했습니다.`
})

// MiniRocket --------------------------------------------------------------

const windows = computed(() => {
  const scores = props.analysis.windowScores || []
  const starts = props.analysis.windowStartsS || []
  const offset = props.analysis.trackStartS || 0
  const maxAbs = Math.max(...scores.map((s) => Math.abs(s)), 1e-9)
  return scores.map((score, i) => {
    const start = starts[i] != null ? offset + starts[i] : null
    return {
      score,
      height: (Math.abs(score) / maxAbs) * 100,
      label: start != null ? `${start.toFixed(1)}–${(start + 2).toFixed(1)}초` : `창 ${i + 1}`,
    }
  })
})

const droneWindows = computed(() => windows.value.filter((w) => w.score >= 0).length)
const birdWindows = computed(() => windows.value.length - droneWindows.value)

const rejectionText = computed(() => {
  const r = props.analysis.windowRejections || {}
  return Object.entries(r).map(([k, n]) => `${WINDOW_REJECTION[k] || k} ${n}개`).join(' · ')
})

function signed(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '-'
  return (value > 0 ? '+' : '') + value.toFixed(digits)
}

/** 피처 값은 단위가 제각각이라(px/s, 비율 등) 자릿수를 크기에 맞춘다. 0.0003 이 0.000 으로 뭉개지지 않게. */
function formatValue(value) {
  if (value == null) return '-'
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 100) return value.toFixed(0)
  if (abs >= 1) return value.toFixed(2)
  if (abs >= 0.001) return value.toPrecision(2)
  return value.toExponential(1)
}
</script>

<template>
  <div class="evidence">
    <!-- RF ---------------------------------------------------------------->
    <template v-if="!isMiniRocket">
      <p v-if="!hasRfEvidence" class="faint evidence__empty">
        <template v-if="analysis.rejectReason">
          규칙 필터에서 탈락해 모델을 부르지 않았습니다. 위의 사유가 판단 근거입니다.
        </template>
        <template v-else>이 결과에는 피처별 근거 정보가 없습니다 (이전 버전 서버 결과).</template>
      </p>

      <template v-else>
        <p class="evidence__formula mono">
          드론 확률 {{ droneProba.toFixed(2) }}
          = 기준 {{ rfBase?.toFixed(2) ?? '-' }}
          {{ rfSum >= 0 ? '+' : '−' }} 피처 기여 {{ Math.abs(rfSum).toFixed(2) }}
        </p>
        <p class="evidence__verdict">{{ rfVerdict }}</p>

        <div class="evidence__legend faint">
          <span>← 새 쪽으로 민 피처</span>
          <span>드론 쪽으로 민 피처 →</span>
        </div>
        <div class="rf">
          <div v-for="row in rfRows" :key="row.name" class="rf__row">
            <span class="rf__name" :title="row.name">{{ row.label }}</span>
            <span class="rf__value mono faint">{{ formatValue(row.value) }}</span>
            <div class="rf__bar">
              <div class="rf__half rf__half--bird">
                <div v-if="row.contribution < 0" class="rf__fill rf__fill--bird" :style="{ width: row.width + '%' }" />
              </div>
              <div class="rf__half">
                <div v-if="row.contribution >= 0" class="rf__fill rf__fill--drone" :style="{ width: row.width + '%' }" />
              </div>
            </div>
            <span class="rf__num mono">{{ signed(row.contribution, 3) }}</span>
          </div>
        </div>
        <p class="faint evidence__note">
          이 궤적이 100개 트리에서 지나간 분기마다 드론 확률이 얼마나 바뀌었는지를 피처별로 더한 값입니다.
          기준값은 학습 데이터 전체의 평균 드론 확률입니다.
        </p>
      </template>
    </template>

    <!-- MiniRocket -------------------------------------------------------->
    <template v-else>
      <p v-if="!windows.length" class="faint evidence__empty">
        판정에 쓸 2초 창이 없습니다.<template v-if="rejectionText"> 제외된 창: {{ rejectionText }}</template>
      </p>

      <template v-else>
        <p class="evidence__formula mono">
          평균 margin {{ signed(analysis.decisionScore) }}
          = 창 {{ windows.length }}개 점수의 평균
        </p>
        <p class="evidence__verdict">
          드론 쪽 창 {{ droneWindows }}개, 새 쪽 창 {{ birdWindows }}개.
          평균이 {{ (analysis.decisionScore ?? 0) >= 0 ? '양수라 드론' : '음수라 새' }}(으)로 판정했습니다.
        </p>

        <div class="mr">
          <div class="mr__axis faint"><span>드론 쪽 ↑</span><span>새 쪽 ↓</span></div>
          <div class="mr__chart">
            <div v-for="(w, i) in windows" :key="i" class="mr__col" :title="`${w.label} · margin ${signed(w.score)}`">
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
          2초 구간을 1초씩 밀어가며 잘라 구간마다 점수(Ridge margin)를 냅니다. 확률이 아니라 방향과 세기입니다.
        </p>
      </template>
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
  border-radius: 8px;
  background: var(--bg-panel);
}
.evidence__formula { margin: 0; font-size: 13px; font-weight: 600; }
.evidence__verdict { margin: 0; font-size: 12px; }
.evidence__note, .evidence__empty { margin: 0; font-size: 11px; line-height: 1.5; }
.evidence__legend { display: flex; justify-content: space-between; font-size: 11px; padding-left: 210px; padding-right: 56px; }

.rf { display: flex; flex-direction: column; gap: 4px; }
.rf__row { display: grid; grid-template-columns: 120px 80px 1fr 56px; align-items: center; gap: 10px; font-size: 12px; }
.rf__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf__value { text-align: right; font-size: 11px; }
.rf__num { text-align: right; font-size: 11px; }
.rf__bar { display: flex; height: 10px; }
.rf__half { flex: 1; display: flex; }
.rf__half--bird { justify-content: flex-end; border-right: 1px solid var(--border-strong); }
.rf__fill { height: 100%; border-radius: 2px; }
.rf__fill--drone { background: var(--drone); }
.rf__fill--bird { background: var(--bird); }

.mr { display: flex; gap: 8px; }
.mr__axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; padding: 18px 0 22px; }
.mr__chart { flex: 1; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.mr__col { flex: 1; min-width: 44px; display: flex; flex-direction: column; align-items: stretch; }
.mr__num { text-align: center; font-size: 10px; height: 16px; }
.mr__up, .mr__down { height: 46px; display: flex; justify-content: center; }
.mr__up { align-items: flex-end; border-bottom: 1px solid var(--border-strong); }
.mr__down { align-items: flex-start; }
.mr__fill { width: 60%; border-radius: 2px; }
.mr__fill--drone { background: var(--drone); }
.mr__fill--bird { background: var(--bird); }
.mr__label { text-align: center; font-size: 10px; margin-top: 4px; white-space: nowrap; }
</style>
