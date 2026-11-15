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
 * 시계열 모델(MultiRocket Stack / MiniRocket)은 확률이 아니라 판정 점수(decision_score)를 준다.
 * 양수면 드론, 음수면 새 쪽이다. %로 바꾸면 확률로 오해하므로 부호 있는 점수 그대로 보여준다.
 */
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'
import { modelLabel } from '../lib/aiModel.js'
import MiniRocketEvidence from './MiniRocketEvidence.vue'

const props = defineProps({
  analysis: { type: Object, required: true },
  canReplay: { type: Boolean, default: false },
  activeWindow: { type: Object, default: null },
})

defineEmits(['redraw', 'play-window'])

const LABEL = {
  bird: { text: '새', color: 'var(--bird)' },
  drone: { text: '드론', color: 'var(--drone)' },
  uncertain: { text: '판단불가', color: 'var(--uncertain)' },
}

/** uncertain 사유 (모델의 abstain_reason) */
const REJECT_REASON = {
  invalid_input: '입력 궤적이 모델 계약에 맞지 않습니다 (보정 좌표·FPS 등).',
  insufficient_observation: '2초 분석 창을 만들 만큼 관측이 없습니다. 더 긴 구간을 지정해 주세요.',
  low_separation: '새와 드론 점수 차이가 작아 판정을 보류했습니다.',
}

const label = computed(() => LABEL[props.analysis.label] || {
  text: props.analysis.label || '알 수 없음',
  color: 'var(--text-dim)',
})

const isUncertain = computed(() => props.analysis.label === 'uncertain')

/** 판단 근거는 기본으로 펼친다. 새 결과가 오면 다시 펼친다. */
// 판단 근거는 처음에 접어 둔다. 새 결과가 오면 다시 접는다.
const showEvidence = ref(false)
watch(() => props.analysis, () => { showEvidence.value = false })

/** 판정 점수. 부호를 붙여 방향(드론 +, 새 -)이 보이게 한다. */
const scoreText = computed(() => {
  const score = props.analysis.decisionScore
  if (score == null) return '-'
  return (score > 0 ? '+' : '') + score.toFixed(2)
})

const reasonText = computed(() => {
  const reason = props.analysis.rejectReason
  if (!reason) return null
  return REJECT_REASON[reason] || reason
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
      <div class="result__verdict">
        <span class="eyebrow">판정</span>
        <span class="result__label">{{ label.text }}</span>
      </div>

      <div class="result__conf">
        <span class="eyebrow">판정 점수</span>
        <template v-if="Number.isFinite(analysis.decisionScore)">
          <b class="mono result__num">{{ scoreText }}</b>
          <span class="faint result__score-note">{{ isUncertain ? '판정 보류 · ' : '' }}양수면 드론, 음수면 새 · 확률 아님</span>
        </template>
        <span v-else class="dim result__none">분류 점수 없음</span>
      </div>

      <div style="flex: 1" />

      <div class="result__tools">
        <span v-if="analysis.model" class="badge mono" :title="analysis.modelVersion || ''">
          {{ modelLabel(analysis.model) }}
        </span>
        <button
          class="result__toggle"
          :class="{ 'result__toggle--on': showEvidence }"
          :aria-expanded="showEvidence"
          @click="showEvidence = !showEvidence"
        >판단 근거 <Icon :name="showEvidence ? 'up' : 'down'" :size="12" /></button>
        <button class="btn-ghost" @click="$emit('redraw')">다시 지정</button>
      </div>
    </div>

    <p v-if="reasonText" class="note">
      <b>사유</b> · {{ reasonText }}
      <span class="faint mono">({{ analysis.rejectReason }})</span>
      <span v-if="analysis.rejectDetail" class="faint"> · {{ analysis.rejectDetail }}</span>
    </p>

    <MiniRocketEvidence v-if="showEvidence" :analysis="analysis" :can-replay="canReplay" :active-window="activeWindow" @play-window="$emit('play-window', $event)" />

    <dl v-if="processingLabel" class="result__meta">
      <div><dt>처리</dt><dd class="mono">{{ processingLabel }}</dd></div>
    </dl>
  </div>
</template>

<style scoped>
.result {
  flex: none;
  padding: 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
}
/* 판정 색은 왼쪽 세로 띠 하나로만 알린다. */
.result::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14px;
  width: 3px;
  height: 46px;
  background: var(--label-color);
}

.result__head { display: flex; align-items: flex-start; gap: 28px; flex-wrap: wrap; }
.result__verdict { display: flex; flex-direction: column; gap: 4px; }
.result__label {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--label-color);
  line-height: 1.05;
}
.result__conf { min-width: 140px; display: flex; flex-direction: column; gap: 4px; }
.result__num { font-size: 20px; font-weight: 600; line-height: 1.2; }
.result__num small { font-size: 12px; color: var(--text-dim); margin-left: 1px; }
.result__none { font-size: 13px; line-height: 1.9; }
.result__score-note { font-size: 12px; }

.result__tools { display: flex; align-items: center; gap: 6px; align-self: center; }
.result__toggle--on { border-color: var(--text-dim); background: var(--bg-elevated); }

.result__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 0;
  font-size: 12px;
}
.result__meta > div { display: flex; gap: 6px; align-items: baseline; }
.result__meta dt { color: var(--text-faint); font-size: 12px; }
.result__meta dd { margin: 0; }

</style>
