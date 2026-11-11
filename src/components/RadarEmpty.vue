<script setup>
/**
 * 빈 화면 그림. 레이더 위로 스캔 선이 한 바퀴 돌 때마다 빨간 객체가 한 번씩 검출된다.
 * "대기 중이지만 무엇을 하는 장비인지"를 보여 준다. 선과 면만 쓰는 평면 그림이고 아이콘은 없다.
 * 제목과 설명은 슬롯으로 받는다.
 */
defineProps({ size: { type: Number, default: 132 } })
</script>

<template>
  <div class="radar-empty">
    <svg class="radar" :width="size" :height="size" viewBox="-70 -70 140 140" aria-hidden="true">
      <!-- 거리 고리와 십자선 -->
      <g fill="none" stroke="currentColor" stroke-width="1" class="radar__grid">
        <circle r="66" />
        <circle r="44" />
        <circle r="22" />
        <path d="M-66 0H66M0 -66V66" />
        <path d="M-46.7 -46.7 46.7 46.7M46.7 -46.7-46.7 46.7" opacity="0.45" />
      </g>
      <!-- 눈금 -->
      <g stroke="currentColor" stroke-width="1" class="radar__ticks">
        <path v-for="n in 36" :key="n" :transform="`rotate(${n * 10})`" :d="n % 3 === 0 ? 'M0 -66V-60' : 'M0 -66V-63'" />
      </g>

      <!-- 스캔 선. 꼬리는 단계별로 옅어지는 선 몇 개로 표현한다(그라데이션 없음). -->
      <g class="radar__sweep">
        <path d="M0 0V-66" stroke="currentColor" stroke-width="1.5" class="radar__beam" />
        <path d="M0 0V-66" stroke="currentColor" stroke-width="1" class="radar__beam radar__beam--t1" transform="rotate(-6)" />
        <path d="M0 0V-66" stroke="currentColor" stroke-width="1" class="radar__beam radar__beam--t2" transform="rotate(-12)" />
        <path d="M0 0V-66" stroke="currentColor" stroke-width="1" class="radar__beam radar__beam--t3" transform="rotate(-18)" />
      </g>

      <!-- 검출된 빨간 객체 -->
      <g class="radar__blip" transform="translate(30 -26)">
        <circle class="radar__pulse" r="4" fill="none" stroke="var(--drone)" stroke-width="1.5" />
        <circle r="4" fill="var(--drone)" />
        <path d="M-9 -4V-9H-4M9 -4V-9H4M-9 4V9H-4M9 4V9H4" fill="none" stroke="var(--drone)" stroke-width="1.5" />
      </g>
      <circle r="1.6" fill="currentColor" />
    </svg>
    <div class="radar-empty__text">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.radar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 28px;
  text-align: center;
}
.radar-empty__text { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.radar-empty__text :deep(p) { margin: 0; }
.radar-empty__text :deep(.radar-empty__title) { font-size: 14px; font-weight: 600; }
.radar-empty__text :deep(.faint) { max-width: 300px; font-size: 12.5px; line-height: 1.6; }

.radar { color: #4a5666; overflow: visible; }
.radar__grid { opacity: 0.9; }
.radar__ticks { opacity: 0.7; }
.radar__sweep { color: #8fbafb; transform-origin: 0 0; animation: radar-spin 4s linear infinite; }
.radar__beam--t1 { opacity: 0.55; }
.radar__beam--t2 { opacity: 0.3; }
.radar__beam--t3 { opacity: 0.14; }

/* 스캔 선이 지나간 직후(약 0.55초 지점)에 켜졌다가 서서히 흐려진다. */
.radar__blip { animation: radar-blip 4s linear infinite; animation-delay: 0.55s; }
.radar__pulse { transform-box: fill-box; transform-origin: center; animation: radar-pulse 4s ease-out infinite; animation-delay: 0.55s; }

@keyframes radar-spin { to { transform: rotate(360deg); } }
@keyframes radar-blip {
  0% { opacity: 1; }
  60% { opacity: 0.75; }
  100% { opacity: 0.4; }
}
@keyframes radar-pulse {
  0% { transform: scale(1); opacity: 1; }
  30% { transform: scale(4.2); opacity: 0; }
  100% { transform: scale(4.2); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .radar__sweep { animation: none; transform: rotate(40deg); }
  .radar__blip { animation: none; opacity: 1; }
  .radar__pulse { animation: none; opacity: 0; }
}
</style>
