<script setup>
/**
 * 앱 진입점.
 *
 * 로그인 여부로 먼저 갈리고, 그다음 해시로 화면을 고른다.
 * ready 가 false 인 동안은 아무것도 그리지 않는다. 그러지 않으면 새로고침할 때마다
 * 로그인 화면이 한 번 번쩍였다가 관제 화면으로 바뀐다.
 *
 * 라우터 라이브러리를 쓰지 않는 이유는 그대로다. 화면 사이에 공유할 상태도, 중첩
 * 라우트도, 경로 파라미터도 없다. 해시 하나면 충분하다.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useAuth } from './composables/useAuth.js'
import LoginView from './components/LoginView.vue'
import AppShell from './components/AppShell.vue'
import ConsoleView from './components/ConsoleView.vue'
import UploadView from './components/UploadView.vue'
import HistoryView from './components/HistoryView.vue'

const { user, ready, initialize } = useAuth()

const VIEWS = {
  live: ConsoleView,
  upload: UploadView,
  history: HistoryView,
}

const view = ref(readHash())

function readHash() {
  const key = location.hash.replace(/^#\/?/, '')
  return VIEWS[key] ? key : 'live'
}

function onHashChange() {
  view.value = readHash()
}

function changeView(key) {
  location.hash = `#/${key}`
}

const currentView = computed(() => VIEWS[view.value])

onMounted(() => {
  // 여기서 GET /api/auth/me 가 한 번 나간다.
  // 세션 확인 + XSRF-TOKEN 쿠키 확보를 겸한다. 이게 빠지면 로그인 POST 부터 403.
  initialize()
  window.addEventListener('hashchange', onHashChange)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange))
</script>

<template>
  <div v-if="!ready" class="boot">
    <div class="spinner" />
    <span class="dim">세션 확인 중</span>
  </div>

  <LoginView v-else-if="!user" />

  <AppShell v-else :view="view" @change="changeView">
    <component :is="currentView" />
  </AppShell>
</template>

<style scoped>
.boot {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
</style>
