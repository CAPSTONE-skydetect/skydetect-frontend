<script setup>
/**
 * 분석 결과.
 *
 * ── 판단불가(uncertain)를 오류로 그리지 않는 게 이 컴포넌트의 핵심이다 ──
 * uncertain 은 파이프라인이 정상 동작한 결과값이다. 빨간 에러로 그리면
 * 운영자가 "시스템이 고장났다"고 읽는다. 그래서 새/드론과 같은 격의
 * 결과 카드로 그리되 색만 다르게 하고, **왜** 판단하지 못했는지를 붙인다.
 *
 * 또 하나: skydetect-ai 는 uncertain 일 때 confidence 를 0.0 으로 준다.
 * 이건 "신뢰도 0%"가 아니라 "점수를 매기지 않았다"는 뜻이다.
 * 0% 막대를 그리면 거짓말이 되므로 아예 다르게 표시한다.
 */
import { computed } from 'vue'

const props = defineProps({
  analysis: { type: Object, required: true },
})

defineEmits(['redraw'])

const LABEL = {
  bird: { text: '새', color: 'var(--bird)' },
  drone: { text: '드론', color: 'var(--drone)' },
  uncertain: { text: '판단불가', color: 'var(--uncertain)' },
}

/**
 * uncertain 사유. skydetect-ai 의 RejectReason 네 가지를 모두 받는다.
 * (제안 명세에는 short_track 하나만 적혀 있었지만 실제 어휘는 넷이다)
 */
const REJECT_REASON = {
  short_track: '추적된 구간이 너무 짧다',
  feature_error: '특징 계산에 실패했다',
  high_noise: '관측 잡음이 커서 궤적을 믿기 어렵다',
  low_confidence: '분류 신뢰도가 기준에 못 미쳤다',
}

const STABILITY = { good: '양호', fair: '보통', poor: '불량' }
const FEATURE_STATUS = { ok: '정상', partial: '일부 보간', failed: '실패' }

const label = computed(() => LABEL[props.analysis.label] || {
  text: props.analysis.label || '알 수 없음',
  color: 'var(--text-dim)',
})

const isUncertain = computed(() => props.analysis.label === 'uncertain')

const confidencePercent = computed(() => Math.round((props.analysis.confidence || 0) * 100))

const confidenceBarStyle = computed(() => ({
  width: confidencePercent.value + '%',
  background: label.value.color,
}))

const reasonText = computed(() => {
  const reason = props.analysis.rejectReason
  if (!reason) return null
  return REJECT_REASON[reason] || reason
})

const quality = computed(() => props.analysis.quality || null)

const topFeatures = computed(() => {
  const features = props.analysis.topFeatures
  if (!features) return []
  return Object.entries(features).sort((a, b) => b[1] - a[1]).slice(0, 3)
})

const processingLabel = computed(() => {
  const ms = props.analysis.processingTimeMs
  if (ms == null) return null
  return (ms / 1000).toFixed(1) + '초'
})
</script>

<template>
  <div class="result" :style="{ '--label-color': label.color }">
    <div class="result__head">
      <span class="result__label">{{ label.text }}</span>

      <div v-if="!isUncertain" class="result__conf">
        <div class="result__conf-row">
          <span class="dim">신뢰도</span>
          <b class="mono">{{ confidencePercent }}%</b>
        </div>
        <div class="result__bar">
          <div class="result__bar-fill" :style="confidenceBarStyle" />
        </div>
      </div>

      <div v-else class="result__conf">
        <!-- 0.0 을 0% 막대로 그리지 않는다. 점수 자체를 매기지 않은 것이다. -->
        <span class="dim">분류 점수 없음</span>
      </div>

      <div style="flex: 1" />
      <button @click="$emit('redraw')">다시 지정</button>
    </div>

    <p v-if="reasonText" class="result__reason">
      <b>사유</b> · {{ reasonText }}
      <span class="faint mono">({{ analysis.rejectReason }})</span>
    </p>

    <div class="result__meta">
      <span v-if="processingLabel" class="faint">처리 {{ processingLabel }}</span>
      <template v-if="quality">
        <span class="faint">추적 {{ quality.numPoints }}프레임</span>
        <span class="faint">평균 신뢰도 {{ (quality.meanConf * 100).toFixed(0) }}%</span>
        <span class="faint">트랙 품질 {{ STABILITY[quality.trackStability] || quality.trackStability }}</span>
        <span class="faint">특징 {{ FEATURE_STATUS[quality.featureStatus] || quality.featureStatus }}</span>
      </template>
    </div>

    <div v-if="topFeatures.length" class="result__features">
      <span class="faint">주요 특징</span>
      <span v-for="[name, weight] in topFeatures" :key="name" class="badge mono result__feature">
        {{ name }} {{ weight.toFixed(2) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.result {
  flex: none;
  padding: 14px;
  border-top: 2px solid var(--label-color);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.result__head { display: flex; align-items: center; gap: 18px; }
.result__label {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--label-color);
  line-height: 1;
}
.result__conf { min-width: 150px; display: flex; flex-direction: column; gap: 5px; }
.result__conf-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.result__bar {
  height: 5px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.result__bar-fill { height: 100%; transition: width 300ms ease; }

.result__reason {
  margin: 0;
  padding: 9px 11px;
  border-radius: var(--radius);
  background: #2a2417;
  color: var(--uncertain);
  font-size: 13px;
}

.result__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
}
.result__features { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.result__feature { font-size: 11px; }
</style>
