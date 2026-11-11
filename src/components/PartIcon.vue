<script setup>
/**
 * 시작 화면의 파트 선택 카드에 쓰는 선 아이콘. 색 없이 currentColor 한 가지, 두께 1.5 로만 그린다.
 *   live    비디오 카메라(실시간 영상)
 *   upload  받침대 위로 올라가는 화살표(영상 올리기)
 */
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 28 },
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
  >
    <g v-if="name === 'live'">
      <rect x="2.75" y="6.75" width="12.5" height="10.5" />
      <path d="M15.25 10.5 21.25 7.5v9l-6-3" />
    </g>
    <g v-else-if="name === 'upload'">
      <path d="M12 15.5V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M3.75 14.5v5.75h16.5V14.5" />
    </g>
    <g v-else-if="name === 'history'">
      <rect x="3.75" y="3.75" width="16.5" height="16.5" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </g>
  </svg>
</template>
