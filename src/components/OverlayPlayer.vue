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
import TrackOverlay from './TrackOverlay.vue'
import { toFrameIndex } from '../lib/videoGeometry.js'

const props = defineProps({
  /** 원본 영상 주소 (업로드한 파일의 objectURL) */
  src: { type: String, default: null },
  /** AI 의 TrackSequence */
  track: { type: Object, default: null },
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
  const history = props.track?.history
  if (!history?.length) return null
  return { from: history[0].frame_index, to: history[history.length - 1].frame_index }
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
watch(() => props.track, () => {
  playing.value = false
  jumpToTrackStart()
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
        v-if="track"
        :video-el="videoEl"
        :track="track"
        :fps="fps"
        :show-trail="showTrail"
      />

      <div v-if="!track" class="player__empty">
        <p class="faint">추적을 실행하면 궤적이 여기에 재생된다</p>
      </div>
    </div>

    <div class="player__controls">
      <button class="player__icon" :disabled="!track" @click="togglePlay">
        {{ playing ? '❚❚' : '▶' }}
      </button>
      <button class="player__icon" :disabled="!track" @click="seekToFrame(frameIndex - 1)">◀</button>
      <input
        class="player__range"
        type="range"
        :min="0" :max="lastFrame" :value="frameIndex"
        :disabled="!track"
        @input="seekToFrame(Number($event.target.value))"
      />
      <button class="player__icon" :disabled="!track" @click="seekToFrame(frameIndex + 1)">▶</button>

      <span class="mono player__frame">
        frame <b>{{ frameIndex }}</b> / {{ lastFrame }}
        <span class="faint">· {{ timeLabel }}</span>
      </span>
    </div>

    <div class="player__legend">
      <label class="player__toggle">
        <input v-model="showTrail" type="checkbox" :disabled="!track" />
        <span>궤적</span>
      </label>

      <span class="player__key"><i class="player__swatch player__swatch--box" />프레임별 검출</span>
      <span class="player__key"><i class="player__swatch player__swatch--trail" />지나온 경로</span>

      <div style="flex: 1" />

      <template v-if="trackRange">
        <span class="faint mono">추적 구간 f{{ trackRange.from }}–f{{ trackRange.to }}</span>
        <button class="player__jump" @click="jumpToTrackStart">시작으로</button>
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
  background: #05080c;
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
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 20px;
}
.player__empty p { margin: 0; }

.player__controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
.player__icon { padding: 4px 10px; min-width: 34px; }
.player__range { flex: 1; accent-color: var(--accent); width: auto; }
.player__frame { font-size: 12px; white-space: nowrap; }

.player__legend {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  flex-wrap: wrap;
}
.player__toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.player__toggle input { width: auto; accent-color: var(--accent); }
.player__key { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.player__swatch { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
.player__swatch--box { background: var(--bird); height: 9px; width: 9px; border: 1px solid var(--bird); background: transparent; }
.player__swatch--trail { background: var(--accent); }
.player__jump { padding: 2px 9px; font-size: 11px; }
</style>
