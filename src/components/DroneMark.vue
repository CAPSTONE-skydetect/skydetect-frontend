<script setup>
/**
 * 로고 마크. 위에서 본 쿼드콥터 드론.
 * 각진 마름모 몸체, 가는 암, 네 개의 로터(고리 + 십자 날개)로 그린다. 선만 쓰고 색은 currentColor 하나다.
 */
defineProps({ size: { type: Number, default: 20 } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" class="drone-mark">
    <!-- 암 -->
    <path d="M9.4 9.4 6 6M14.6 9.4 18 6M9.4 14.6 6 18M14.6 14.6 18 18" />
    <!-- 로터 고리 -->
    <circle cx="4.6" cy="4.6" r="3" />
    <circle cx="19.4" cy="4.6" r="3" />
    <circle cx="4.6" cy="19.4" r="3" />
    <circle cx="19.4" cy="19.4" r="3" />
    <!-- 로터 날개 -->
    <path stroke-width="1" d="M2.6 4.6h4M4.6 2.6v4M17.4 4.6h4M19.4 2.6v4M2.6 19.4h4M4.6 17.4v4M17.4 19.4h4M19.4 17.4v4" />
    <!-- 몸체 -->
    <path d="M12 8.2 15.8 12 12 15.8 8.2 12Z" fill="currentColor" stroke="none" />
  </svg>
</template>

<style scoped>
.drone-mark { display: block; flex: none; }
</style>
