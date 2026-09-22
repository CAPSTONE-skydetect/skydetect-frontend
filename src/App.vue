<script setup>
/**
 * 앱 진입점이자 유일한 분기.
 *
 * 라우터가 없으므로 "로그인했는가"만 보고 두 화면 중 하나를 그린다.
 * ready 가 false 인 동안은 아무것도 그리지 않는다. 그러지 않으면 새로고침할 때마다
 * 로그인 화면이 한 번 번쩍였다가 관제 화면으로 바뀐다.
 */
import { onMounted } from 'vue'
import { useAuth } from './composables/useAuth.js'
import LoginView from './components/LoginView.vue'
import ConsoleView from './components/ConsoleView.vue'

const { user, ready, initialize } = useAuth()

// 여기서 GET /api/auth/me 가 한 번 나간다.
// 세션 확인 + XSRF-TOKEN 쿠키 확보를 겸한다. 이게 빠지면 로그인 POST 부터 403.
onMounted(initialize)
</script>

<template>
  <div v-if="!ready" class="boot">
    <div class="spinner" />
    <span class="dim">세션 확인 중</span>
  </div>

  <LoginView v-else-if="!user" />
  <ConsoleView v-else />
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
