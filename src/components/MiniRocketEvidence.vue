<script setup>
import { computed } from 'vue'
import DecisionEvidence from './DecisionEvidence.vue'
import { minirocketEvidence, trackingQuality } from '../lib/minirocketEvidence.js'
const props = defineProps({
  analysis: { type: Object, required: true },
  canReplay: { type: Boolean, default: false },
  activeWindow: { type: Object, default: null },
})
const emit = defineEmits(['play-window'])
const evidence = computed(() => minirocketEvidence(props.analysis))
const quality = computed(() => trackingQuality(props.analysis.quality))
const maxScore = computed(() => Math.max(...evidence.value.windows.map(w => Math.abs(w.score)), 1e-9))
const rejectionLabels = { short_track: '구간 길이 부족', long_gap: '긴 추적 끊김', missing_fraction: '누락 비율 초과', resampling_support: '관측점 부족' }
const rejections = computed(() => Object.entries(props.analysis.windowRejections || {})
  .filter(([, n]) => Number.isInteger(n) && n > 0).map(([key, n]) => ({ text: `${rejectionLabels[key] || key} ${n}개`, count: n })))
const excluded = computed(() => props.analysis.windowRejections == null ? null : rejections.value.reduce((sum, r) => sum + r.count, 0))
const used = computed(() => Number.isInteger(props.analysis.windowsUsed) ? props.analysis.windowsUsed : evidence.value.windows.length || null)
const interval = w => w.start !== null ? `${w.start.toFixed(1)}–${w.end.toFixed(1)}초` : `구간 ${w.index + 1} · 시각 없음`
const selected = w => w && props.activeWindow?.start === w.start && props.activeWindow?.end === w.end
const tooltip = w => `${interval(w)} · 판정 점수 ${w.score > 0 ? '+' : ''}${w.score.toFixed(3)} · 확률 아님`
function play(w) {
  if (w && props.canReplay && w.start !== null) emit('play-window', { start: w.start, end: w.end })
}
</script>

<template>
  <section class="mr-evidence" data-testid="minirocket-evidence">
    <p class="mr-evidence__summary">{{ evidence.summary }}</p>
    <section v-if="evidence.windows.length" class="mr-evidence__section">
      <div class="mr-evidence__heading"><h4>구간별 판단</h4><span class="dim">드론 방향 {{ evidence.drone }}개 · 새 방향 {{ evidence.bird }}개<template v-if="evidence.neutral"> · 경계 {{ evidence.neutral }}개</template></span></div>
      <div class="mr-timeline">
        <div class="mr-timeline__axis faint"><span>드론 ↑</span><span>새 ↓</span></div>
        <div class="mr-timeline__windows">
          <button v-for="w in evidence.windows" :key="w.index" class="mr-timeline__window"
            :class="{ 'is-selected': selected(w) }" :aria-pressed="!!selected(w)"
            :disabled="!canReplay || w.start === null" :title="tooltip(w)" :aria-label="`${tooltip(w)} · 구간 재생`" @click="play(w)">
            <span class="mr-timeline__plot"><i :class="w.score < 0 ? 'is-bird' : 'is-drone'" :style="{ height: `${Math.abs(w.score) / maxScore * 48}%` }" /></span>
            <span class="mr-timeline__time">{{ interval(w) }}</span>
          </button>
        </div>
      </div>
      <p class="faint mr-evidence__note">구간을 누르면 원본 영상을 재생합니다. 서로 겹치는 2초 구간이며, 개수 비율은 확률이 아닙니다.</p>
    </section>
    <section class="mr-evidence__section">
      <h4>서로 다른 판단이 나온 장면</h4>
      <div class="mr-evidence__windows">
        <div v-for="item in evidence.representatives" :key="item.side" class="mr-evidence__window" :class="{ 'is-selected': selected(item.window) }">
          <span class="dim">{{ item.name }} 방향 대표 구간</span>
          <template v-if="item.window">
            <b>{{ interval(item.window) }}</b>
            <button :disabled="!canReplay || item.window.start === null" @click="play(item.window)">장면 확인</button>
          </template>
          <span v-else class="faint">{{ evidence.windows.length ? `${item.name} 방향 점수를 낸 구간은 없습니다.` : '구간별 점수 정보가 없습니다.' }}</span>
        </div>
      </div>
      <p class="faint mr-evidence__note">각 방향에서 점수 크기가 가장 큰 장면입니다. 특정 움직임이 판정의 직접적인 원인이라는 뜻은 아닙니다.</p>
      <p v-if="!canReplay" class="faint mr-evidence__note">재생할 원본 영상이 연결되지 않았습니다.</p>
    </section>
    <section class="mr-evidence__section">
      <h4>분석에 사용한 데이터</h4>
      <dl class="mr-evidence__quality">
        <div><dt>분석 창이 덮는 시간</dt><dd>{{ evidence.coveredSeconds === null ? '정보 없음' : `${evidence.coveredSeconds.toFixed(1)}초` }}</dd><small class="faint">중복 제외 · 실제 관측 시간과 다름</small></div>
        <div><dt>사용 구간</dt><dd>{{ used === null ? '정보 없음' : `${used}개` }}</dd></div>
        <div><dt>제외 구간</dt><dd>{{ excluded === null ? '정보 없음' : `${excluded}개` }}</dd></div>
        <div><dt>관측 누락률</dt><dd>{{ quality.missing }}</dd><small class="faint">추적 시도 구간 기준</small></div>
      </dl>
      <p class="faint mr-evidence__note">관측의 연속성 정보입니다. 같은 객체를 정확하게 추적했다는 보장은 아닙니다.</p>
      <details v-if="rejections.length"><summary>제외된 구간과 사유</summary><p class="dim mr-evidence__note">{{ rejections.map(r => r.text).join(' · ') }}</p><p class="faint mr-evidence__note">서버가 사유별 개수만 제공해 제외 구간의 영상 시각은 표시하지 않습니다.</p></details>
    </section>
    <details class="mr-evidence__details">
      <summary>상세 점수와 계산 방식</summary>
      <p class="faint mr-evidence__note">사용된 구간 점수의 평균을 사용합니다. 최종 분류와 보류 여부는 서버 결과를 그대로 표시합니다.</p>
      <DecisionEvidence :analysis="analysis" />
      <p class="faint mr-evidence__note">모델 버전: {{ analysis.modelVersion || '정보 없음' }} · 수치 판정·보류 기준: 응답에 미제공</p>
      <p class="faint mr-evidence__note">기록된 관측 {{ quality.points }} · 추적기 품질 등급 {{ quality.stability }} · 점수는 확률이 아닙니다.</p>
    </details>
  </section>
</template>

<style scoped>
.mr-evidence { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.mr-evidence__summary { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.6; }
.mr-evidence__note { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.mr-evidence__section { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 14px; }
.mr-evidence h4 { margin: 0; font-size: 12px; }
.mr-evidence__heading { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; font-size: 12px; }
.mr-evidence__windows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.mr-evidence__window { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
.mr-evidence__window > .dim { flex-basis: 100%; }
.mr-evidence__window > button { margin-left: auto; }
.is-selected { border-color: var(--accent) !important; }
.mr-evidence__quality { display: flex; flex-wrap: wrap; gap: 16px 32px; margin: 0; }
.mr-evidence__quality dt { color: var(--text-dim); font-size: 12px; }
.mr-evidence__quality dd { margin: 5px 0; font-size: 15px; font-weight: 600; }
.mr-evidence__quality small { font-size: 11px; }
.mr-evidence__details { border-top: 1px solid var(--border); padding-top: 12px; min-width: 0; }
.mr-evidence summary { cursor: pointer; font-size: 12px; }
.mr-evidence details[open] > * + * { margin-top: 12px; }
.mr-timeline { display: flex; min-width: 0; gap: 8px; }
.mr-timeline__axis { display: flex; flex-direction: column; justify-content: space-between; padding: 12px 0 30px; font-size: 11px; white-space: nowrap; }
.mr-timeline__windows { display: flex; flex: 1; min-width: 0; overflow-x: auto; gap: 4px; }
.mr-timeline__window { display: flex; flex-direction: column; flex: 1; min-width: 90px; height: auto; padding: 6px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; }
.mr-timeline__plot { position: relative; display: block; height: 68px; width: 100%; }
.mr-timeline__plot::after { content: ''; position: absolute; top: 50%; left: 0; right: 0; border-top: 1px solid var(--border-strong); }
.mr-timeline__plot i { position: absolute; left: 25%; width: 50%; }
.mr-timeline__plot .is-drone { bottom: 50%; background: var(--drone); }
.mr-timeline__plot .is-bird { top: 50%; background: var(--bird); }
.mr-timeline__time { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
@media (max-width: 650px) { .mr-evidence__windows { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
