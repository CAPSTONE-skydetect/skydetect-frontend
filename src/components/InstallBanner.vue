<script setup>
/**
 * 모바일로 처음 들어왔을 때 로그인 폼 위에 보이는 "홈 화면에 추가" 안내.
 * Android 는 설치 버튼, iOS 는 방법 안내. 닫으면 다시 뜨지 않고, 이미 설치한 앱에서는 뜨지 않는다.
 */
import { computed } from 'vue'
import { useLocale } from '../composables/useLocale.js'
import { currentInstallMode, promptInstall, dismissInstall } from '../lib/installPrompt.js'
import DroneMark from './DroneMark.vue'

const { t } = useLocale()
const mode = computed(() => currentInstallMode())
</script>

<template>
  <aside v-if="mode" class="install" role="region" :aria-label="t('install.title')">
    <span class="install__icon"><DroneMark :size="22" /></span>
    <div class="install__text">
      <strong>{{ t('install.title') }}</strong>
      <span v-if="mode === 'ios'">{{ t('install.ios') }}</span>
      <span v-else>{{ t('install.android') }}</span>
    </div>
    <button v-if="mode === 'prompt'" type="button" class="btn-primary install__add" @click="promptInstall">
      {{ t('install.add') }}
    </button>
    <button type="button" class="btn-ghost install__close" :aria-label="t('install.close')" @click="dismissInstall">✕</button>
  </aside>
</template>

<style scoped>
/* 화면에 떠 있지 않고 로그인 폼 위에 그냥 놓이는 블록이다. 움직이지 않아서 누르기 쉽다. */
.install {
  flex: none;
  width: 100%;
  max-width: 340px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-elevated);
}
.install__icon {
  flex: none; width: 36px; height: 36px; display: grid; place-items: center;
  border-radius: var(--radius); color: #e8edf3; background: #2a3038; border: 1px solid #3d4651;
}
.install__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 1.5; color: var(--text-dim); }
.install__text strong { font-size: 13px; color: var(--text); }
.install__add { flex: none; height: 40px; padding: 0 16px; font-size: 13px; }
.install__close { flex: none; width: 40px; height: 40px; padding: 0; }
</style>
