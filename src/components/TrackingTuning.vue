<script setup>
/**
 * A 파트 추적 파라미터 조절판.
 *
 * 값의 범위와 기본값은 AI 의 `ai_server/tracking_schemas.py` (TrackingTuning /
 * ManualTrackingRequest) 에서 가져왔다. 설명 문구는 CODEX 브랜치의 수동 ROI UI
 * (`ai_server/static/index.html`) 에 있던 것을 그대로 옮겼다. 두 곳이 달라지면
 * 스키마 쪽이 기준이다.
 *
 * 범위를 벗어난 값을 보내면 pydantic 이 422 로 거절하므로 min/max 를 스키마와
 * 정확히 맞춰둔다.
 */
import { computed } from 'vue'
import { DEFAULT_TUNING } from '../api/ai.js'
import TrackerProfileSelect from './TrackerProfileSelect.vue'

const props = defineProps({
  /** { kltAcceptConf, recoveryConf, updateConf, searchRadius, onlineUpdate } */
  tuning: { type: Object, required: true },
  /** { stabilize, resizeWidth, maxSeconds } */
  options: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
  /** 'column' 세로 패널용, 'row' 화면 아래 가로 바용 */
  layout: { type: String, default: 'column' },
})

const emit = defineEmits(['update:tuning', 'update:options'])

function setTuning(key, value) {
  emit('update:tuning', { ...props.tuning, [key]: value })
}

function setOption(key, value) {
  emit('update:options', { ...props.options, [key]: value })
}

function reset() {
  emit('update:tuning', { ...DEFAULT_TUNING })
}

/**
 * 학습 conf 는 온라인 외형 학습이 켜져 있을 때만 의미가 있다.
 * OFF 면 외형 모델을 갱신하지 않으므로 이 임계값을 쓸 일이 없다.
 */
const updateConfActive = computed(() => props.tuning.onlineUpdate)

const isDefault = computed(() =>
  Object.keys(DEFAULT_TUNING).every((key) => props.tuning[key] === DEFAULT_TUNING[key]),
)
</script>

<template>
  <div class="tuning" :class="[`tuning--${layout}`, { 'tuning--disabled': disabled }]">
    <div class="tuning__head">
      <span class="eyebrow">추적 설정</span>
      <div style="flex: 1" />
      <button class="btn-ghost btn-sm" type="button" :disabled="disabled || isDefault" @click="reset">
        기본값
      </button>
    </div>

    <div class="tuning__fields">
    <TrackerProfileSelect :model-value="tuning.trackerVariant ?? 'd0'" :disabled="disabled"
      @update:model-value="setTuning('trackerVariant', $event)" />
    <div class="tuning__row">
      <label class="field">
        <span class="dim">추적 시간 (초)</span>
        <input
          type="number" min="1" step="1"
          :value="options.maxSeconds ?? ''"
          :disabled="disabled"
          placeholder="전체"
          @input="setOption('maxSeconds', $event.target.value === '' ? null : Number($event.target.value))"
        />
      </label>

      <label class="field">
        <span class="dim">처리 해상도 (px)</span>
        <input
          type="number" min="320" max="7680" step="80"
          :value="options.resizeWidth"
          :disabled="disabled"
          @input="setOption('resizeWidth', Number($event.target.value))"
        />
      </label>
    </div>

    <div class="tuning__checks">
    <label class="tuning__check">
      <input
        type="checkbox"
        :checked="options.stabilize"
        :disabled="disabled"
        @change="setOption('stabilize', $event.target.checked)"
      />
      <span><b>카메라 움직임 보정</b></span>
    </label>

    <label class="tuning__check">
      <input
        type="checkbox"
        :checked="tuning.onlineUpdate"
        :disabled="disabled"
        @change="setTuning('onlineUpdate', $event.target.checked)"
      />
      <span>
        <b>온라인 외형 학습 <em class="mono">{{ tuning.onlineUpdate ? 'ON' : 'OFF' }}</em></b>
        <small class="faint">OFF면 처음 지정한 외형을 고정합니다.</small>
      </span>
    </label>
    </div>

    <label class="range">
      <span class="range__label">
        <b>유지 conf</b>
        <output class="mono">{{ tuning.kltAcceptConf.toFixed(2) }}</output>
      </span>
      <input
        type="range" min="0.10" max="0.95" step="0.01"
        :value="tuning.kltAcceptConf"
        :disabled="disabled"
        @input="setTuning('kltAcceptConf', Number($event.target.value))"
      />
      <small class="faint">높이면 배경 고착은 줄지만 LOST 판정이 빨라집니다.</small>
    </label>

    <label class="range">
      <span class="range__label">
        <b>재탐색 conf</b>
        <output class="mono">{{ tuning.recoveryConf.toFixed(2) }}</output>
      </span>
      <input
        type="range" min="0.10" max="0.95" step="0.01"
        :value="tuning.recoveryConf"
        :disabled="disabled"
        @input="setTuning('recoveryConf', Number($event.target.value))"
      />
      <small class="faint">낮추면 재포착이 쉬워지지만 오탐 위험이 커집니다.</small>
    </label>

    <label class="range range--update" :class="{ 'range--off': !updateConfActive }">
      <span class="range__label">
        <b>학습 conf</b>
        <output class="mono">{{ tuning.updateConf.toFixed(2) }}</output>
      </span>
      <input
        type="range" min="0.10" max="0.99" step="0.01"
        :value="tuning.updateConf"
        :disabled="disabled || !updateConfActive"
        @input="setTuning('updateConf', Number($event.target.value))"
      />
      <small class="faint">
        확실한 KLT 프레임만 외형 모델에 반영합니다.
        <template v-if="!updateConfActive">온라인 외형 학습이 켜져야 쓰입니다.</template>
      </small>
    </label>

    <label class="range">
      <span class="range__label">
        <b>검색 반경</b>
        <output class="mono">{{ tuning.searchRadius.toFixed(1) }}x</output>
      </span>
      <input
        type="range" min="1.0" max="8.0" step="0.1"
        :value="tuning.searchRadius"
        :disabled="disabled"
        @input="setTuning('searchRadius', Number($event.target.value))"
      />
      <small class="faint">빠른 객체일수록 크게 설정하세요.</small>
    </label>
    </div>
  </div>
</template>

<style scoped>
.tuning { padding: 14px; border-top: 1px solid var(--border); }
.tuning--disabled { opacity: 0.55; }

.tuning__fields { display: flex; flex-direction: column; gap: 14px; }

/* 화면 아래 가로 바. 3열 격자로 줄을 맞춘다.
   1행: 추적 시간 / 처리 해상도 / 체크 2개
   2행: 유지 / 재탐색 / 검색 반경
   3행: 학습
   학습 conf 는 마크업에서 검색 반경보다 앞에 있어서 order 로 한 칸 뒤로 보낸다. */
.tuning--row .tuning__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}
.tuning--row .tuning__row { grid-column: 1 / span 2; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.tuning--row .range--update { order: 1; }

.tuning__checks { display: flex; flex-direction: column; gap: 12px; }

.tuning__head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }

.tuning__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }

.tuning__check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 12px;
  cursor: pointer;
}
.tuning__check input { width: auto; margin-top: 2px; accent-color: var(--accent); }
.tuning__check span { display: flex; flex-direction: column; gap: 2px; }
.tuning__check em { font-style: normal; font-size: 12px; color: var(--accent); }
.tuning__check small, .range small { font-size: 12px; line-height: 1.4; }

.range { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
.range--off { opacity: 0.5; }
.range__label { display: flex; align-items: baseline; justify-content: space-between; }
.range__label output { color: var(--accent); font-size: 12px; }
.range input[type='range'] { width: 100%; accent-color: var(--accent); }
</style>
