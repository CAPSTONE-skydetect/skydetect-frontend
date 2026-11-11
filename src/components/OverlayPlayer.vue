<script setup>
/**
 * 추적 오버레이 재생기.
 *
 * 원본 영상 위에 A 파트가 뽑은 궤적과 프레임별 검출 박스를 겹쳐 재생한다.
 *
 * AI 가 만들어주는 overlay.mp4 를 쓰지 않는 이유는 코덱이다. OpenCV 의
 * `VideoWriter_fourcc(*"mp4v")` 는 MPEG-4 Part 2 를 쓰는데 브라우저가 이걸
 * 디코딩하지 못한다 (붙여보면 readyState 가 0 에서 안 올라간다). H.264 만 된다.
 *
 * 직접 그리는 쪽이 오히려 낫다.
 *   - 원본 해상도 그대로 본다. overlay.mp4 는 처리 해상도(기본 1280)로 줄어 있다
 *   - 프레임 단위로 앞뒤로 돌려볼 수 있다
 *   - 궤적 전체를 미리 그려 어디로 지나갔는지 한눈에 보인다
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import TrackOverlay from './TrackOverlay.vue'
import RadarEmpty from './RadarEmpty.vue'
import { toFrameIndex } from '../lib/videoGeometry.js'

const props = defineProps({
  /** 원본 영상 주소 (업로드한 파일의 objectURL) */
  src: { type: String, default: null },
  /** api/ai.js fetchTrajectory 가 만든 점 목록 (raw 좌표 기준) */
  points: { type: Array, default: null },
  fps: { type: Number, default: 30 },
  frameCount: { type: Number, default: 0 },
})

const videoEl = ref(null)
const playing = ref(false)
const frameIndex = ref(0)
const showTrail = ref(true)

const lastFrame = computed(() => Math.max(0, (props.frameCount || 1) - 1))

/** 추적이 커버하는 구간. 그 밖에서는 박스가 안 뜨는 게 정상이다. */
const trackRange = computed(() => {
  const points = props.points
  if (!points?.length) return null
  return { from: points[0].frameIndex, to: points[points.length - 1].frameIndex }
})

const inTrackRange = computed(() => {
  const range = trackRange.value
  if (!range) return false
  return frameIndex.value >= range.from && frameIndex.value <= range.to
})

function seekToFrame(index) {
  const video = videoEl.value
  if (!video || !props.fps) return
  const clamped = Math.min(Math.max(0, index), lastFrame.value)
  frameIndex.value = clamped
  video.currentTime = (clamped + 0.2) / props.fps
}

function onTimeUpdate() {
  const video = videoEl.value
  if (!video || !props.fps) return
  frameIndex.value = toFrameIndex(video.currentTime, props.fps, props.frameCount)
}

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) {
    video.play()
    playing.value = true
  } else {
    video.pause()
    playing.value = false
  }
}

/** 추적이 시작된 프레임으로 바로 간다. 긴 영상에서 매번 찾아가기 번거롭다. */
function jumpToTrackStart() {
  if (trackRange.value) seekToFrame(trackRange.value.from)
}

// 결과가 바뀌면 추적 시작 지점에서 다시 본다.
// 결과가 오면 추적 시작 지점부터 바로 재생해서 박스가 따라가며 궤적이 쌓이는 모습을 보여 준다.
watch(() => props.points, () => {
  playing.value = false
  jumpToTrackStart()
  if (props.points?.length) {
    videoEl.value?.play().then(() => { playing.value = true }).catch(() => {})
  }
})

onBeforeUnmount(() => {
  videoEl.value?.pause()
})

const timeLabel = computed(() => {
  if (!props.fps) return ''
  return (frameIndex.value / props.fps).toFixed(2) + 's'
})
</script>

<template>
  <div class="player">
    <div class="player__stage">
      <video
        ref="videoEl"
        class="player__video"
        :src="src"
        playsinline
        muted
        preload="auto"
        @loadedmetadata="jumpToTrackStart"
        @timeupdate="onTimeUpdate"
        @ended="playing = false"
      />
      <TrackOverlay
        v-if="points"
        :video-el="videoEl"
        :points="points"
        :fps="fps"
        :show-trail="showTrail"
      />

      <div v-if="!points" class="player__empty">
        <RadarEmpty :size="116">
          <p class="radar-empty__title">ROI 추적 전</p>
          <p class="faint">왼쪽에서 객체를 지정하고 ROI 추적을 누르세요</p>
        </RadarEmpty>
      </div>
    </div>

    <div class="strip player__controls">
      <button class="btn-ghost btn-icon" :disabled="!points" :aria-label="playing ? '일시정지' : '재생'" @click="togglePlay">
        <Icon :name="playing ? 'pause' : 'play'" />
      </button>
      <button class="btn-ghost btn-icon" :disabled="!points" aria-label="이전 프레임" @click="seekToFrame(frameIndex - 1)"><Icon name="prev" /></button>
      <input
        class="player__range"
        type="range"
        :min="0" :max="lastFrame" :value="frameIndex"
        :disabled="!points"
        @input="seekToFrame(Number($event.target.value))"
      />
      <button class="btn-ghost btn-icon" :disabled="!points" aria-label="다음 프레임" @click="seekToFrame(frameIndex + 1)"><Icon name="next" /></button>

      <span class="mono player__frame">
        frame <b>{{ frameIndex }}</b> / {{ lastFrame }}
        <span class="faint">· {{ timeLabel }}</span>
      </span>
    </div>

    <div class="strip player__legend">
      <label class="player__toggle">
        <input v-model="showTrail" type="checkbox" :disabled="!points" />
        <span>궤적</span>
      </label>

      <span class="player__key"><i class="player__swatch player__swatch--box" />프레임별 검출</span>
      <span class="player__key"><i class="player__swatch player__swatch--trail" />지나온 경로</span>

      <div style="flex: 1" />

      <template v-if="trackRange">
        <span class="faint mono">추적 구간 f{{ trackRange.from }}–f{{ trackRange.to }}</span>
        <button class="btn-ghost btn-sm" @click="jumpToTrackStart">시작으로</button>
        <span v-if="!inTrackRange" class="badge badge--warn">구간 밖</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.player {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.player__stage {
  position: relative;
  flex: 1;
  min-height: 180px;
  background: var(--bg-video);
  overflow: hidden;
}
.player__video {
  width: 100%;
  height: 100%;
  /* TrackOverlay 의 fit:'contain' 과 반드시 같아야 한다. */
  object-fit: contain;
  display: block;
}
.player__empty {
  background: var(--bg-video);
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 20px;
}

.player__controls {
  gap: 4px;
}
.player__range { flex: 1; accent-color: var(--accent); width: auto; }
.player__frame { font-size: 12px; white-space: nowrap; }

.player__legend {
  gap: 12px;
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: 12px;
  flex-wrap: wrap;
}
.player__toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.player__toggle input { width: auto; accent-color: var(--accent); }
.player__key { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.player__swatch { width: 12px; height: 3px; display: inline-block; }
.player__swatch--box { background: var(--bird); height: 9px; width: 9px; border: 1px solid var(--bird); background: transparent; }
.player__swatch--trail { background: var(--accent); }
</style>
