<script setup>
/**
 * 시작 화면. 왼쪽은 스크롤하며 읽는 소개와 이용 안내, 오른쪽은 로그인과 파트 선택이다.
 *
 * 로그인해도 화면이 바뀌지 않는다. 오른쪽만 아이디/비밀번호 폼에서 "어디로 들어갈지" 고르는
 * 카드로 바뀌고, 하나를 고르면 그때 해당 파트(실시간 / 업로드 / 기록)로 들어간다.
 * 실제 이동은 App.vue 가 하고, 여기서는 enter 이벤트로 고른 파트만 알린다.
 *
 * 폼 제출이 이 앱의 첫 POST 다. App.vue 가 시작할 때 GET /api/auth/me 로
 * XSRF-TOKEN 쿠키를 받아둔 덕분에 http 래퍼가 헤더를 붙일 수 있다.
 * 그 GET 이 없으면 여기서 바로 403 이 난다.
 */
import { ref, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useLocale } from '../composables/useLocale.js'
import LoginDemo from './LoginDemo.vue'
import LoginGuide from './LoginGuide.vue'
import DroneMark from './DroneMark.vue'
import PartIcon from './PartIcon.vue'

const emit = defineEmits(['enter'])

const { user, login, logout, sessionExpired } = useAuth()
const { t, isKo, setLocale } = useLocale()

const PARTS = [
  { key: 'live', title: 'login.enter.live', text: 'login.enter.live.text' },
  { key: 'upload', title: 'login.enter.upload', text: 'login.enter.upload.text' },
  { key: 'history', title: 'login.enter.history', text: 'login.enter.history.text' },
]

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
    // 성공하면 user 가 채워지고, 오른쪽이 파트 선택 카드로 바뀐다. 화면 이동은 없다.
  } catch (err) {
    error.value = err
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
  if (err.status === 0) return t('login.err.network')
  if (err.code === 'LOGIN_FAILED') return err.message
  if (err.status === 403) return t('login.err.csrf')
  return err.message || t('login.err.fallback')
}
// 오류 객체를 들고 있다가 그릴 때 번역해야 언어를 바꿨을 때 문구도 따라 바뀐다.
const errorText = computed(() => (error.value ? messageFor(error.value) : ''))
</script>

<template>
  <div class="login">
    <aside class="login__side">
      <!-- 스크롤해도 위에 붙어 있는 줄 -->
      <div class="login__top">
        <div class="login__brand">
          <DroneMark :size="24" />
          <span>SkyDetect</span>
        </div>
        <div class="lang" role="group" :aria-label="t('lang.switch')">
          <button type="button" :class="{ on: !isKo }" :aria-pressed="!isKo" @click="setLocale('en')">EN</button>
          <button type="button" :class="{ on: isKo }" :aria-pressed="isKo" @click="setLocale('ko')">한국어</button>
        </div>
      </div>

      <div class="login__scroll">
        <div class="login__inner">
          <section class="login__hero">
            <h1>{{ t('login.title') }}</h1>
            <p class="dim">{{ t('login.subtitle') }}</p>
            <div class="login__demo"><LoginDemo /></div>
            <p class="login__hint mono">↓ {{ t('login.scroll') }}</p>
          </section>

          <LoginGuide />
        </div>
      </div>
    </aside>

    <main class="login__main">
      <!-- 로그인 전: 아이디/비밀번호 -->
      <form v-if="!user" class="login__form" @submit.prevent="onSubmit">
        <h2>{{ t('login.heading') }}</h2>

        <p v-if="sessionExpired" class="note">{{ t('login.expired') }}</p>

        <label class="login__field">
          <span>{{ t('login.username') }}</span>
          <input v-model="username" autocomplete="username" autofocus />
        </label>

        <label class="login__field">
          <span>{{ t('login.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" />
        </label>

        <p v-if="error" class="login__error">{{ errorText }}</p>

        <button class="btn-primary login__submit" type="submit" :disabled="!canSubmit">
          <span v-if="submitting" class="spinner login__spinner" />
          {{ submitting ? t('login.submitting') : t('login.submit') }}
        </button>
      </form>

      <!-- 로그인 후: 들어갈 파트 고르기 -->
      <div v-else class="login__form login__choose">
        <p class="login__who mono">{{ t('login.welcome') }} <b>{{ user.username }}</b></p>

        <!-- 실시간 / 업로드는 가로로 나란히 놓은 정사각형 카드 -->
        <div class="parts">
          <button
            v-for="p in PARTS.slice(0, 2)"
            :key="p.key"
            type="button"
            class="part"
            @click="emit('enter', p.key)"
          >
            <PartIcon :name="p.key" :size="34" class="part__icon" />
            <span class="part__body">
              <strong>{{ t(p.title) }}</strong>
              <span>{{ t(p.text) }}</span>
            </span>
            <span class="part__arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <button type="button" class="part part--row" @click="emit('enter', 'history')">
          <PartIcon name="history" :size="18" />
          <strong>{{ t('login.enter.history') }}</strong>
          <span class="part__arrow" aria-hidden="true">→</span>
        </button>

        <button type="button" class="btn-ghost login__signout" @click="logout">{{ t('login.signout') }}</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(480px, 8fr) minmax(0, 5fr);
}

/* 왼쪽: 위 줄은 고정, 아래 글은 스크롤. */
.login__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
}
.login__top {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 40px;
  height: 64px;
  border-bottom: 1px solid var(--border);
}
.login__scroll { flex: 1; min-height: 0; overflow-y: auto; }
.login__inner { padding: 0 40px; max-width: 760px; margin: 0 auto; }

.login__hero { padding: 40px 0 28px; }
.login__hero h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.25; font-weight: 700; letter-spacing: -0.02em; }
.login__hero p { margin: 0; max-width: 460px; font-size: 14px; line-height: 1.65; }
.login__demo { margin-top: 24px; }
.login__hint { margin: 16px 0 0; font-size: 12px; color: var(--text-faint); }

.lang { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 4px; overflow: hidden; }
.lang button {
  height: 26px; padding: 0 11px; border: 0; border-radius: 0;
  background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600;
  cursor: pointer;
}
.lang button + button { border-left: 1px solid var(--border-strong); }
.lang button:hover { color: var(--text); background: var(--bg-hover); }
.lang button.on { background: var(--accent-dim); color: var(--accent-text); }
.login__brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }

/* 오른쪽: 로그인 / 파트 선택 */
.login__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}
.login__form {
  width: 100%;
  max-width: 340px;
  min-width: 0;
  flex: none;
  margin-block: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.login__form h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.login__field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-dim); }
.login__field input { height: 38px; font-size: 14px; color: var(--text); }
.login__error { margin: 0; color: var(--danger); font-size: 12px; }
.login__submit { height: 40px; margin-top: 4px; font-size: 13px; }
.login__spinner { border-color: rgba(8, 20, 42, 0.3); border-top-color: var(--on-accent); }

.login__choose {
  /* Keep intrinsic card heights in flow instead of shrinking a nested flex item. */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-width: 440px;
  gap: 10px;
}
.login__who { margin: 0; font-size: 12px; color: var(--text-faint); }
.login__who b { color: var(--text); font-weight: 600; }

.parts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.part {
  -webkit-appearance: none;
  appearance: none;
  position: relative;
  width: 100%;
  min-width: 0;
  height: auto;
  aspect-ratio: 1 / 1;
  padding: 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-start;
  text-align: left;
  white-space: normal;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-panel);
  color: var(--text);
}
.part__icon { color: var(--text); flex: none; }
.part__body { display: flex; flex-direction: column; min-width: 0; max-width: 100%; overflow-wrap: anywhere; gap: 6px; padding-right: 8px; }
.part__body strong { font-size: 15px; font-weight: 600; }
.part__body span { font-size: 12px; line-height: 1.5; color: var(--text-dim); font-weight: 400; }
.part__arrow { position: absolute; right: 16px; top: 16px; color: var(--text-faint); }
.part:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-dim); }
.part:hover .part__arrow { color: var(--accent-text); }
.part--row {
  aspect-ratio: auto;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  margin-top: 0;
}
.part--row strong { font-size: 13px; font-weight: 500; }
.part--row .part__arrow { position: static; margin-left: auto; }
.login__signout { justify-self: start; margin-top: 8px; }

@media (max-width: 800px) {
  .login {
    height: auto;
    min-height: 100%;
    grid-template-columns: minmax(0, 1fr);
  }
  .login__main {
    grid-row: 1;
    min-height: 100svh;
    overflow: visible;
  }
  .login__side {
    grid-row: 2;
    min-width: 0;
    border-right: 0;
    border-top: 1px solid var(--border);
  }
  /* Use page scrolling below the entry panel, not a nested guide scroller. */
  .login__scroll { flex: none; overflow: visible; }
  .login__top { padding-inline: 24px; }
  .login__inner { padding-inline: 24px; }
}
</style>
