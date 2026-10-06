<script setup>
/**
 * 분석 결과.
 *
 * 판단불가(uncertain)는 오류가 아니라 파이프라인이 정상 동작한 결과값이다.
 * 빨간 에러로 그리면 운영자가 고장으로 읽으므로, 새/드론과 같은 격의 결과
 * 카드로 그리되 색만 다르게 하고 사유를 붙인다.
 *
 * AI 는 uncertain 일 때 confidence 를 0.0 으로 준다. 신뢰도 0% 가 아니라
 * 점수를 매기지 않았다는 뜻이라 0% 막대 대신 다르게 표시한다.
 *
 * MiniRocket 은 확률이 아니라 Ridge margin(decision_score)을 준다. 양수면 드론,
 * 음수면 새 쪽이다. %로 바꾸면 확률로 오해하므로 부호 있는 점수 그대로 보여준다.
 */
import { computed } from 'vue'
import { modelLabel } from '../lib/aiModel.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  /** B 가 피처를 못 뽑은 사유 코드 목록 (AI 응답의 features.reasons) */
  featureReasons: { type: Array, default: null },
})

defineEmits(['redraw'])

const LABEL = {
  bird: { text: '새', color: 'var(--bird)' },
  drone: { text: '드론', color: 'var(--drone)' },
  uncertain: { text: '판단불가', color: 'var(--uncertain)' },
}

/**
 * uncertain 사유.
 *
 * 두 층이 있다. C 의 RuleFilter 가 떨어뜨린 경우(rejectReason)와, 그 전에 B 가
 * 피처를 못 뽑은 경우(featureReasons)다. 둘 다 보여줘야 다음에 뭘 할지 안다.
 * 문구는 CODEX 브랜치 UI 의 REJECT_TEXT / REASON_TEXT 를 그대로 옮겼다.
 */
const REJECT_REASON = {
  short_track: '추적된 프레임이 너무 적습니다. 더 긴 구간을 지정해 주세요.',
  feature_error: '피처 계산에 실패했습니다.',
  high_noise: '추적이 불안정합니다 (결측·지터 과다). 대비가 뚜렷한 구간을 다시 지정해 주세요.',
  low_confidence: '관측 신뢰도가 낮습니다. ROI를 대상에 더 정확히 맞춰 주세요.',
  // MiniRocket 보류 사유 (abstain_reason)
  invalid_input: '입력 궤적이 모델 계약에 맞지 않습니다 (보정 좌표·FPS 등).',
  insufficient_observation: '2초 분석 창을 만들 만큼 관측이 없습니다. 더 긴 구간을 지정해 주세요.',
  low_separation: '새와 드론 점수 차이가 작아 판정을 보류했습니다.',
}

/** B(피처 추출)가 계산을 거부한 사유. research.features 가 내는 코드다. */
const FEATURE_REASON = {
  insufficient_points: '관측된 점이 너무 적습니다. 더 긴 구간을 추적해 주세요.',
  insufficient_duration: '추적 구간이 너무 짧습니다.',
  excessive_missing_fraction: '추적이 끊긴 구간이 너무 많습니다.',
  no_usable_contiguous_segment: '연속으로 이어진 구간이 없습니다.',
  partial_timestamps: '일부 프레임에 타임스탬프가 없습니다.',
  nonfinite_features: '피처 계산 결과가 유효하지 않습니다.',
  nonfinite_input: '추적 좌표에 유효하지 않은 값이 있습니다.',
}

const STABILITY = { good: '양호', fair: '보통', poor: '불량' }
const FEATURE_STATUS = { ok: '정상', partial: '일부 보간', failed: '실패' }

const label = computed(() => LABEL[props.analysis.label] || {
  text: props.analysis.label || '알 수 없음',
  color: 'var(--text-dim)',
})

const isUncertain = computed(() => props.analysis.label === 'uncertain')

const isMiniRocket = computed(() => props.analysis.model === 'minirocket')

/** MiniRocket margin. 부호를 붙여 방향(드론 +, 새 -)이 보이게 한다. */
const scoreText = computed(() => {
  const score = props.analysis.decisionScore
  if (score == null) return '-'
  return (score > 0 ? '+' : '') + score.toFixed(2)
})

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

/**
 * 주요 특징은 판정이 실제로 나왔을 때만 뜻이 있다. 탈락한 트랙의 피처 값을
 * 보여주면 모델이 그 값을 보고 판단한 것처럼 읽힌다 (CODEX 도 같은 이유로 숨긴다).
 */
const topFeatures = computed(() => {
  if (isUncertain.value) return []
  const features = props.analysis.topFeatures
  if (!features) return []
  return Object.entries(features).sort((a, b) => b[1] - a[1]).slice(0, 3)
})

/** 피처 단계에서 걸린 사유. rejectReason 과 층이 다르므로 따로 보여준다. */
const featureReasonTexts = computed(() =>
  (props.featureReasons || []).map((code) => FEATURE_REASON[code] || code),
)

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

      <div v-if="!isUncertain && isMiniRocket" class="result__conf">
        <div class="result__conf-row">
          <span class="dim">판정 점수</span>
          <b class="mono">{{ scoreText }}</b>
        </div>
        <span class="faint result__score-note">
          Ridge margin · 확률 아님<template v-if="analysis.windowsUsed"> · 2초 창 {{ analysis.windowsUsed }}개</template>
        </span>
      </div>

      <div v-else-if="!isUncertain" class="result__conf">
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
      <span v-if="analysis.model" class="badge mono" :title="analysis.modelVersion || ''">
        {{ modelLabel(analysis.model) }}
      </span>
      <button @click="$emit('redraw')">다시 지정</button>
    </div>

    <p v-if="reasonText" class="result__reason">
      <b>사유</b> · {{ reasonText }}
      <span class="faint mono">({{ analysis.rejectReason }})</span>
      <span v-if="analysis.rejectDetail" class="faint"> · {{ analysis.rejectDetail }}</span>
    </p>

    <p v-if="featureReasonTexts.length" class="result__reason result__reason--feature">
      <b>피처 단계</b> · {{ featureReasonTexts.join(' / ') }}
      <span class="faint mono">({{ featureReasons.join(', ') }})</span>
    </p>

    <div class="result__meta">
      <span v-if="processingLabel" class="faint">처리 {{ processingLabel }}</span>
      <template v-if="quality">
        <span class="faint">추적 {{ quality.numPoints }}프레임</span>
        <span class="faint">평균 신뢰도 {{ (quality.meanConf * 100).toFixed(0) }}%</span>
        <span class="faint">트랙 품질 {{ STABILITY[quality.trackStability] || quality.trackStability }}</span>
        <span v-if="quality.featureStatus" class="faint">특징 {{ FEATURE_STATUS[quality.featureStatus] || quality.featureStatus }}</span>
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
.result__score-note { font-size: 11px; }
.result__bar {
  height: 5px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.result__bar-fill { height: 100%; transition: width 300ms ease; }

.result__reason--feature { background: #23252b; color: var(--text-dim); }
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
