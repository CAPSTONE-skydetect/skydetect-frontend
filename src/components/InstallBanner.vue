<script setup>
/**
 * 모바일로 처음 들어왔을 때 아래에서 올라오는 "홈 화면에 추가" 안내.
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
  <Transition name="install">
    <aside v-if="mode" class="install" role="dialog" :aria-label="t('install.title')">
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
  </Transition>
</template>

<style scoped>
.install {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.install__icon {
  flex: none; width: 36px; height: 36px; display: grid; place-items: center;
  border-radius: var(--radius); color: #e8edf3; background: #2a3038; border: 1px solid #3d4651;
}
.install__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 1.5; color: var(--text-dim); }
.install__text strong { font-size: 13px; color: var(--text); }
.install__add { flex: none; height: 34px; padding: 0 14px; font-size: 13px; }
.install__close { flex: none; width: 32px; height: 32px; padding: 0; }
.install-enter-active, .install-leave-active { transition: opacity 0.25s, transform 0.25s; }
.install-enter-from, .install-leave-to { opacity: 0; transform: translateY(12px); }
</style>
