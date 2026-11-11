<script setup>
/**
 * 작은 선 아이콘. 글자 기호(▶ ✕ ▾)는 글꼴마다 굵기와 기준선이 달라
 * 버튼 안에서 들쭉날쭉하므로 같은 격자(16px, 1.5px 선)로 그린다.
 */
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 14 },
})
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="square"
    aria-hidden="true"
  >
    <path v-if="name === 'play'" d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
    <g v-else-if="name === 'pause'" fill="currentColor" stroke="none">
      <rect x="4" y="3.5" width="2.5" height="9" />
      <rect x="9.5" y="3.5" width="2.5" height="9" />
    </g>
    <path v-else-if="name === 'prev'" d="M10 4 6 8l4 4" />
    <path v-else-if="name === 'next'" d="M6 4l4 4-4 4" />
    <path v-else-if="name === 'close'" d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    <path v-else-if="name === 'down'" d="M4 6l4 4 4-4" />
    <path v-else-if="name === 'up'" d="M4 10l4-4 4 4" />
    <g v-else-if="name === 'download'">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7" />
      <path d="M3 13.5h10" />
    </g>
    <g v-else-if="name === 'upload'">
      <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5" />
      <path d="M3 13.5h10" />
    </g>
  </svg>
</template>

<style scoped>
.icon { display: block; flex: none; }
</style>
