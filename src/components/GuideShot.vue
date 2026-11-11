<script setup>
/**
 * 실제 화면 스크린샷 위에 단계 번호를 그려 보여 주는 그림.
 *
 * 그림은 1440x900 으로 찍은 실제 화면이다. 표시는 그림 위에 겹친 HTML 이라
 * 그림이 커지거나 줄어도 같은 자리에 붙어 있고, 글자는 흐려지지 않는다.
 * 좌표는 퍼센트로 바꿔 쓰므로 원본 픽셀(rect)만 알면 된다.
 * 그림을 누르면 원본 크기로 새 탭에서 열려 작은 글자도 읽을 수 있다.
 */
import { computed } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  /** [{ n, rect: [x, y, w, h] }] 원본 픽셀 */
  marks: { type: Array, default: () => [] },
  width: { type: Number, default: 1440 },
  height: { type: Number, default: 900 },
  alt: { type: String, default: '' },
})

const boxes = computed(() => props.marks.map((m) => {
  const [x, y, w, h] = m.rect
  return {
    n: m.n,
    // 그림 가장자리에 붙은 상자는 번호가 잘리지 않도록 안쪽에, 나머지는 바깥 모서리에 단다.
    inside: x < 20 || y < 110,
    style: {
      left: (x / props.width) * 100 + '%',
      top: (y / props.height) * 100 + '%',
      width: (w / props.width) * 100 + '%',
      height: (h / props.height) * 100 + '%',
    },
  }
}))
</script>

<template>
  <a class="shot" :href="src" target="_blank" rel="noopener" :style="{ aspectRatio: `${width} / ${height}` }">
    <img :src="src" :alt="alt" :width="width" :height="height" loading="lazy" />
    <span v-for="(b, i) in boxes" :key="i" class="shot__mark" :style="b.style">
      <i class="shot__n mono" :class="{ 'shot__n--in': b.inside }">{{ b.n }}</i>
    </span>
  </a>
</template>

<style scoped>
.shot {
  position: relative;
  display: block;
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-video);
  cursor: zoom-in;
}
.shot img { display: block; width: 100%; height: 100%; }
/* 강조 상자: 단색 노랑 선. 영상 오버레이의 강조색과 같다. */
.shot__mark {
  position: absolute;
  border: 2px solid #ffd23f;
  box-shadow: 0 0 0 1px rgba(5, 7, 9, 0.6);
  pointer-events: none;
}
.shot__n.shot__n--in { transform: none; }
.shot__n {
  position: absolute;
  left: -2px;
  top: -2px;
  transform: translate(-55%, -55%);
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border-radius: 2px;
  background: #ffd23f;
  color: #1b1500;
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}
</style>
