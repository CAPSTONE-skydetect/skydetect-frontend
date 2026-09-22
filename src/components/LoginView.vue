<script setup>
/**
 * 로그인 화면.
 *
 * 폼 제출이 이 앱의 첫 POST 다. App.vue 가 시작할 때 GET /api/auth/me 로
 * XSRF-TOKEN 쿠키를 받아둔 덕분에 http 래퍼가 헤더를 붙일 수 있다.
 * 그 GET 이 없으면 여기서 바로 403 이 난다.
 */
import { ref, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'

const { login, sessionExpired } = useAuth()

const username = ref('operator')
const password = ref('')
const submitting = ref(false)
const error = ref(null)

const canSubmit = computed(
  () => username.value.trim() && password.value && !submitting.value,
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await login(username.value.trim(), password.value)
    // 성공하면 App.vue 의 user 가 채워지면서 관제 화면으로 교체된다.
  } catch (err) {
    error.value = messageFor(err)
    password.value = ''
  } finally {
    submitting.value = false
  }
}

/**
 * 403(CSRF)은 비밀번호 틀림과 전혀 다른 문제라 구분해서 보여준다.
 * 안 그러면 개발 중에 엉뚱한 곳을 뒤지게 된다.
 */
function messageFor(err) {
  if (err.status === 0) return '서버에 연결할 수 없습니다. 백엔드(8080)를 확인하세요.'
  if (err.code === 'LOGIN_FAILED') return err.message
  if (err.status === 403) return 'CSRF 토큰 오류입니다. 새로고침 후 다시 시도하세요.'
  return err.message || '로그인에 실패했습니다.'
}
</script>

<template>
  <div class="login">
    <form class="login__card panel" @submit.prevent="onSubmit">
      <div class="login__brand">
        <span class="login__mark">SkyDetect</span>
        <span class="faint">관제 콘솔</span>
      </div>

      <p v-if="sessionExpired" class="login__notice">
        세션이 만료되었습니다. 다시 로그인하세요.
      </p>

      <label class="login__field">
        <span class="dim">아이디</span>
        <input v-model="username" autocomplete="username" autofocus />
      </label>

      <label class="login__field">
        <span class="dim">비밀번호</span>
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>

      <p v-if="error" class="login__error">{{ error }}</p>

      <button class="login__submit" type="submit" :disabled="!canSubmit">
        <span v-if="submitting" class="spinner" />
        <span>{{ submitting ? '확인 중' : '로그인' }}</span>
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
}
.login__card {
  width: 340px;
  padding: 28px;
  gap: 16px;
}
.login__brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.login__mark {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.login__field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.login__notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: #3a2f16;
  color: var(--uncertain);
  font-size: 13px;
}
.login__error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}
.login__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent-dim);
  border-color: var(--accent);
  padding: 11px;
  font-weight: 600;
}
.login__submit:hover:not(:disabled) { background: #2a6396; }
</style>
