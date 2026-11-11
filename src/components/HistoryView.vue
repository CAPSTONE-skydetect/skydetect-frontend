<script setup>
/**
 * 검출 기록.
 *
 * 저장소는 브라우저다 (lib/historyStore.js). 백엔드에 이력 API 가 없어서다.
 * 한계는 historyStore 주석에 적어뒀고, 화면 아래에도 한 줄로 띄운다.
 * 없는 걸 있는 것처럼 보이면 나중에 "기록이 왜 사라졌지"가 된다.
 */
import { ref, computed, watch, onMounted } from 'vue'
import Icon from './Icon.vue'
import { listHistory, removeHistory, clearHistory } from '../lib/historyStore.js'
import { modelLabel } from '../lib/aiModel.js'
import { trackerLabel } from '../lib/trackerProfiles.js'
import DecisionEvidence from './DecisionEvidence.vue'
import RadarEmpty from './RadarEmpty.vue'

const entries = ref([])
const selectedId = ref(null)
/** 판단 근거 펼침. 다른 기록을 고르면 접는다. */
const showEvidence = ref(false)
watch(selectedId, () => { showEvidence.value = false })
const filter = ref('all')  // all | bird | drone | uncertain

const LABEL = {
  bird: { text: '새', tone: 'ok' },
  drone: { text: '드론', tone: 'error' },
  uncertain: { text: '판단불가', tone: 'warn' },
}

// 문구는 CODEX 브랜치 UI 의 REJECT_TEXT / REASON_TEXT 와 같다.
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

const FEATURE_REASON = {
  insufficient_points: '관측된 점이 너무 적습니다.',
  insufficient_duration: '추적 구간이 너무 짧습니다.',
  excessive_missing_fraction: '추적이 끊긴 구간이 너무 많습니다.',
  no_usable_contiguous_segment: '연속으로 이어진 구간이 없습니다.',
  partial_timestamps: '일부 프레임에 타임스탬프가 없습니다.',
  nonfinite_features: '피처 계산 결과가 유효하지 않습니다.',
  nonfinite_input: '추적 좌표에 유효하지 않은 값이 있습니다.',
}

const STABILITY = { good: '양호', fair: '보통', poor: '불량' }
const SOURCE = { live: '실시간', upload: '업로드' }

onMounted(reload)

function reload() {
  entries.value = listHistory()
  if (!entries.value.some((entry) => entry.id === selectedId.value)) {
    selectedId.value = entries.value[0]?.id || null
  }
}

const visible = computed(() => {
  if (filter.value === 'all') return entries.value
  return entries.value.filter((entry) => entry.label === filter.value)
})

const selected = computed(
  () => entries.value.find((entry) => entry.id === selectedId.value) || null,
)

const counts = computed(() => {
  const base = { all: entries.value.length, bird: 0, drone: 0, uncertain: 0 }
  entries.value.forEach((entry) => {
    if (base[entry.label] !== undefined) base[entry.label] += 1
  })
  return base
})

function onRemove(id) {
  removeHistory(id)
  reload()
}

function onClearAll() {
  if (!entries.value.length) return
  clearHistory()
  reload()
}

function labelOf(entry) {
  return LABEL[entry.label] || { text: entry.label || '-', tone: '' }
}

function timeOf(value) {
  const date = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function confidenceOf(entry) {
  if (entry.label === 'uncertain') return '점수 없음'
  // MiniRocket 은 확률이 아니라 margin 이라 %로 바꾸지 않는다.
  if (entry.model === 'minirocket') {
    const score = entry.decisionScore
    if (score == null) return '-'
    return 'margin ' + (score > 0 ? '+' : '') + score.toFixed(2)
  }
  return Math.round((entry.confidence || 0) * 100) + '%'
}

const tuningRows = computed(() => {
  const t = selected.value?.tuning
  if (!t) return []
  return [
    ['추적 방식', trackerLabel(t.trackerVariant)],
    ['유지 conf', t.kltAcceptConf],
    ['재탐색 conf', t.recoveryConf],
    ['학습 conf', t.updateConf],
    ['검색 반경', t.searchRadius ? t.searchRadius + 'x' : null],
    ['온라인 학습', t.onlineUpdate === undefined ? null : (t.onlineUpdate ? 'ON' : 'OFF')],
    ['움직임 보정', t.stabilize === undefined ? null : (t.stabilize ? 'ON' : 'OFF')],
    ['처리 해상도', t.resizeWidth ? t.resizeWidth + 'px' : null],
    ['추적 시간', t.maxSeconds ? t.maxSeconds + '초' : '전체'],
  ].filter(([, value]) => value !== null && value !== undefined)
})
</script>

<template>
  <main class="history">
    <!-- 목록 -->
    <section class="panel">
      <div class="panel__head">
        <span class="panel__title">검출 기록</span>
        <span class="faint mono">{{ counts.all }}</span>
        <div style="flex: 1" />
        <button class="btn-ghost btn-sm" :disabled="!entries.length" @click="onClearAll">전체 삭제</button>
      </div>

      <div class="history__filters">
        <button
          v-for="key in ['all', 'bird', 'drone', 'uncertain']"
          :key="key"
          class="history__filter"
          :class="{ 'history__filter--on': filter === key }"
          @click="filter = key"
        >
          {{ key === 'all' ? '전체' : LABEL[key].text }}
          <span class="mono history__count">{{ counts[key] }}</span>
        </button>
      </div>

      <div class="panel__body history__list">
        <RadarEmpty v-if="!visible.length" :size="112">
          <p class="radar-empty__title">{{ entries.length ? '해당 결과가 없습니다' : '아직 기록이 없습니다' }}</p>
          <p class="faint">분석을 마친 클립과 업로드 영상이 판정과 함께 여기에 쌓입니다.</p>
        </RadarEmpty>

        <button
          v-for="entry in visible"
          :key="entry.id"
          class="card"
          :class="['card--' + labelOf(entry).tone, { 'card--active': entry.id === selectedId }]"
          @click="selectedId = entry.id"
        >
          <div class="card__thumb">
            <img v-if="entry.thumbnail" :src="entry.thumbnail" alt="" />
            <span v-else class="faint">–</span>
          </div>

          <div class="card__body">
            <div class="card__top">
              <span class="card__label">{{ labelOf(entry).text }}</span>
              <span class="mono card__conf">{{ confidenceOf(entry) }}</span>
              <div style="flex: 1" />
              <span class="card__source">{{ SOURCE[entry.source] || entry.source }}</span>
            </div>
            <div class="card__title">{{ entry.title }}</div>
            <div class="faint mono card__time">{{ timeOf(entry.createdAt) }}</div>
          </div>

          <span class="card__remove" title="삭제" @click.stop="onRemove(entry.id)"><Icon name="close" :size="12" /></span>
        </button>
      </div>
    </section>

    <!-- 상세 -->
    <section class="panel">
      <div class="panel__head">
        <span class="panel__title">상세</span>
        <span v-if="selected" class="badge" :class="'badge--' + labelOf(selected).tone">
          <span class="dot" />{{ labelOf(selected).text }}
        </span>
        <div style="flex: 1" />
        <span v-if="selected" class="faint mono">{{ timeOf(selected.createdAt) }}</span>
      </div>

      <div class="panel__body history__detail">
        <RadarEmpty v-if="!selected" :size="112">
          <p class="radar-empty__title">기록을 선택하세요</p>
          <p class="faint">왼쪽 목록에서 하나를 고르면 판정 근거와 궤적이 여기에 열립니다.</p>
        </RadarEmpty>

        <template v-else>
          <div class="detail__media">
            <img v-if="selected.thumbnail" class="detail__video" :src="selected.thumbnail" alt="" />
            <p v-else class="faint detail__nomedia">남은 화면이 없습니다</p>
          </div>
          <p v-if="selected.overlayUrl" class="detail__note">
            <a :href="selected.overlayUrl" download><Icon name="download" :size="12" />오버레이 내려받기</a>
          </p>

          <p v-if="(selected.featureReasons || []).length" class="note note--muted">
            <b>피처 단계</b> ·
            {{ selected.featureReasons.map((c) => FEATURE_REASON[c] || c).join(' / ') }}
          </p>

          <p v-if="selected.rejectReason" class="note">
            <b>사유</b> · {{ REJECT_REASON[selected.rejectReason] || selected.rejectReason }}
            <span class="faint mono">({{ selected.rejectReason }})</span>
          </p>

          <button
            class="detail__toggle"
            :aria-expanded="showEvidence"
            @click="showEvidence = !showEvidence"
          >판단 근거 <Icon :name="showEvidence ? 'up' : 'down'" :size="12" /></button>
          <DecisionEvidence v-if="showEvidence" :analysis="selected" />

          <dl class="detail__grid">
            <dt class="faint">판정 모델</dt>
            <dd>{{ selected.model ? modelLabel(selected.model) : 'RF' }}</dd>
            <dt class="faint">일시</dt>
            <dd class="mono">{{ timeOf(selected.createdAt) }}</dd>
            <dt class="faint">출처</dt>
            <dd>{{ SOURCE[selected.source] || selected.source }} · {{ selected.title }}</dd>
            <dt class="faint">시작 프레임</dt>
            <dd class="mono">{{ selected.initFrameIndex }}</dd>
            <dt class="faint">bbox (원본 px)</dt>
            <dd class="mono">[{{ (selected.bbox || []).join(', ') }}]</dd>
            <dt class="faint">처리 시간</dt>
            <dd class="mono">
              {{ selected.processingTimeMs ? (selected.processingTimeMs / 1000).toFixed(1) + '초' : '-' }}
            </dd>
          </dl>

          <template v-if="selected.quality">
            <div class="detail__section eyebrow">트랙 품질</div>
            <dl class="detail__grid">
              <dt class="faint">추적 프레임</dt>
              <dd class="mono">{{ selected.quality.numPoints }}</dd>
              <dt class="faint">평균 신뢰도</dt>
              <dd class="mono">{{ Math.round((selected.quality.meanConf || 0) * 100) }}%</dd>
              <dt class="faint">안정성</dt>
              <dd>{{ STABILITY[selected.quality.trackStability] || selected.quality.trackStability }}</dd>
              <dt class="faint">특징 상태</dt>
              <dd>{{ selected.quality.featureStatus }}</dd>
            </dl>
          </template>

          <template v-if="tuningRows.length">
            <div class="detail__section eyebrow">추적 설정</div>
            <dl class="detail__grid">
              <template v-for="[name, value] in tuningRows" :key="name">
                <dt class="faint">{{ name }}</dt>
                <dd class="mono">{{ value }}</dd>
              </template>
            </dl>
          </template>

          <template v-if="selected.topFeatures">
            <div class="detail__section eyebrow">주요 특징</div>
            <div class="detail__features">
              <span
                v-for="(weight, name) in selected.topFeatures"
                :key="name"
                class="mono detail__feature"
              >{{ name }} <b>{{ Number(weight).toFixed(2) }}</b></span>
            </div>
          </template>
        </template>
      </div>

    </section>
  </main>
</template>

<style scoped>
.history {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(340px, 2fr) minmax(0, 3fr);
  gap: var(--gap);
}

/* 판정별 거르기. 탭처럼 아래 선으로 선택을 표시한다. */
.history__filters {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.history__filter {
  height: 34px;
  padding: 0 8px;
  gap: 6px;
  border: none;
  border-radius: 0;
  color: var(--text-dim);
  position: relative;
}
.history__filter:hover:not(:disabled) { background: transparent; color: var(--text); }
.history__filter--on { color: var(--text); font-weight: 600; }
.history__filter--on::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--text);
}
.history__count { font-size: 12px; color: var(--text-faint); }

.history__list { overflow-y: auto; }
.history__empty { margin: auto; font-size: 12px; }

/* 기록 한 줄. 카드 대신 목록 행으로 두고 판정 색은 왼쪽 선으로만 쓴다. */
.card {
  display: flex;
  align-items: stretch;
  gap: 12px;
  height: auto;
  padding: 10px 14px 10px 12px;
  text-align: left;
  width: 100%;
  flex: none;
  position: relative;
  border: none;
  border-left: 2px solid transparent;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  justify-content: flex-start;
}
.card:hover:not(:disabled) { border-color: transparent; border-bottom-color: var(--border); }
.card--active,
.card--active:hover:not(:disabled) { background: var(--bg-hover); border-left-color: var(--text-dim); }
.card--ok .card__label { color: var(--bird); }
.card--error .card__label { color: var(--drone); }
.card--warn .card__label { color: var(--uncertain); }
.card__thumb {
  width: 96px;
  height: 56px;
  flex: none;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-video);
  display: grid;
  place-items: center;
}
.card__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.card__top { display: flex; align-items: baseline; gap: 8px; padding-right: 20px; }
.card__label { font-size: 13px; font-weight: 700; }
.card__conf { font-size: 12px; color: var(--text-dim); }
.card__source { font-size: 12px; color: var(--text-faint); }
.card__title {
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__time { font-size: 12px; }
.card__remove {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--text-faint);
  padding: 3px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  opacity: 0;
}
.card:hover .card__remove, .card--active .card__remove { opacity: 1; }
.card__remove:hover { color: var(--text); background: var(--bg-hover); }

.history__detail { overflow-y: auto; padding: 16px; gap: 14px; }
.detail__media {
  height: 340px;
  background: var(--bg-video);
  overflow: hidden;
  flex: none;
}
.detail__video { width: 100%; height: 100%; object-fit: contain; display: block; }
.detail__nomedia { display: grid; place-items: center; height: 100%; margin: 0; }
.detail__note { font-size: 12px; margin: 0; }
.detail__note a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.detail__note a:hover { text-decoration: underline; }
.detail__toggle { align-self: flex-start; }

.detail__section { padding-top: 12px; border-top: 1px solid var(--border); }
.detail__grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 7px 16px;
  margin: 0;
  font-size: 12px;
}
.detail__grid dt { font-size: 12px; }
.detail__grid dd { margin: 0; }

.detail__features { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; }
.detail__feature { color: var(--text-dim); }
.detail__feature b { color: var(--text); font-weight: 500; }

@media (max-width: 1100px) {
  .history { grid-template-columns: minmax(0, 1fr); grid-auto-rows: min-content; }
  .history > * { min-height: 420px; }
}
</style>
