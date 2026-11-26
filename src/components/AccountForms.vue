<script setup>
/**
 * 로그인 전 계정 화면: 회원가입 / 아이디 찾기 / 비밀번호 찾기 / 새 비밀번호 설정.
 * 로그인 화면의 오른쪽 칸에 로그인 폼 대신 들어간다. 어느 화면인지는 mode 로 정한다.
 *
 * 서버가 주는 오류 문구는 한국어다. 형식 검사 문구(아이디 길이 등)는 그대로 보여 준다.
 */
import { ref, computed } from 'vue'
import { signup, findUsername, requestPasswordReset, confirmPasswordReset } from '../api/account.js'
import { useLocale } from '../composables/useLocale.js'

const props = defineProps({
  /** 'signup' | 'find-id' | 'find-pw' | 'reset' */
  mode: { type: String, required: true },
  /** reset 모드에서 메일 링크가 준 1회용 토큰 */
  token: { type: String, default: '' },
})
const emit = defineEmits(['back', 'signed-up', 'reset-done'])

const { t } = useLocale()

const username = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const submitting = ref(false)
const error = ref(null)
const sent = ref(false)

const title = computed(() => ({
  signup: t('acct.signup.title'),
  'find-id': t('acct.findid.title'),
  'find-pw': t('acct.findpw.title'),
  reset: t('acct.reset.title'),
})[props.mode])

const needsPassword = computed(() => props.mode === 'signup' || props.mode === 'reset')
const mismatch = computed(() => needsPassword.value && confirm.value !== '' && password.value !== confirm.value)

const canSubmit = computed(() => {
  if (submitting.value || sent.value) return false
  if (props.mode === 'signup') return username.value.trim() && email.value.trim() && password.value && password.value === confirm.value
  if (props.mode === 'reset') return props.token && password.value && password.value === confirm.value
  return !!email.value.trim()
})

function messageFor(err) {
  if (err.status === 0) return t('login.err.network')
  if (err.status === 403) return t('login.err.csrf')
  return err.message || t('login.err.fallback')
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    if (props.mode === 'signup') {
      await signup(username.value.trim(), email.value.trim(), password.value)
      emit('signed-up', { username: username.value.trim(), password: password.value })
    } else if (props.mode === 'find-id') {
      await findUsername(email.value.trim())
      sent.value = true
    } else if (props.mode === 'find-pw') {
      await requestPasswordReset(email.value.trim())
      sent.value = true
    } else {
      await confirmPasswordReset(props.token, password.value)
      emit('reset-done')
    }
  } catch (err) {
    error.value = messageFor(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="acct" @submit.prevent="onSubmit">
    <h2>{{ title }}</h2>

    <label v-if="mode === 'signup'" class="acct__field">
      <span>{{ t('login.username') }}</span>
      <input v-model="username" autocomplete="username" autocapitalize="none" autofocus />
      <small>{{ t('acct.username.hint') }}</small>
    </label>

    <label v-if="mode !== 'reset'" class="acct__field">
      <span>{{ t('acct.email') }}</span>
      <input v-model="email" type="email" autocomplete="email" :autofocus="mode !== 'signup'" />
    </label>

    <template v-if="needsPassword">
      <label class="acct__field">
        <span>{{ mode === 'reset' ? t('acct.newpassword') : t('login.password') }}</span>
        <input v-model="password" type="password" autocomplete="new-password" :autofocus="mode === 'reset'" />
        <small>{{ t('acct.password.hint') }}</small>
      </label>
      <label class="acct__field">
        <span>{{ t('acct.password.confirm') }}</span>
        <input v-model="confirm" type="password" autocomplete="new-password" />
        <small v-if="mismatch" class="acct__bad">{{ t('acct.mismatch') }}</small>
      </label>
    </template>

    <p v-if="mode === 'reset' && !token" class="acct__error">{{ t('acct.reset.missing') }}</p>
    <p v-if="error" class="acct__error" role="alert">{{ error }}</p>
    <p v-if="sent" class="acct__ok" role="status">{{ t('acct.sent') }}</p>

    <button class="btn-primary acct__submit" type="submit" :disabled="!canSubmit">
      <span v-if="submitting" class="spinner acct__spinner" />
      {{ submitting ? t('acct.working') : mode === 'signup' ? t('acct.submit.signup') : mode === 'reset' ? t('acct.submit.reset') : t('acct.submit.send') }}
    </button>

    <button type="button" class="btn-ghost acct__back" @click="emit('back')">← {{ t('acct.back') }}</button>
  </form>
</template>

<style scoped>
.acct { width: 100%; max-width: 340px; min-width: 0; flex: none; margin-block: auto; display: flex; flex-direction: column; gap: 16px; }
.acct h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.acct__field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-dim); }
.acct__field input { height: 38px; font-size: 14px; color: var(--text); }
.acct__field small { font-size: 11px; color: var(--text-faint); }
.acct__bad, .acct__error { margin: 0; color: var(--danger); font-size: 12px; }
.acct__ok { margin: 0; font-size: 12px; line-height: 1.6; color: var(--accent-text); }
.acct__submit { height: 40px; margin-top: 4px; font-size: 13px; }
.acct__spinner { border-color: rgba(8, 20, 42, 0.3); border-top-color: var(--on-accent); }
.acct__back { align-self: flex-start; }
</style>
