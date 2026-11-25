<script setup>
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { saveObservation } from '../api/observations.js'
import { updateHistory } from '../lib/historyStore.js'

const props = defineProps({ entry: { type: Object, required: true } })
const emit = defineEmits(['saved'])
const location = ref('')
const memo = ref('')
const saving = ref(false)
const error = ref('')
const saved = ref(false)
let mounted = true
onBeforeUnmount(() => { mounted = false })
const unchanged = computed(() => saved.value
  && location.value.trim() === (props.entry.observationLocation || '')
  && memo.value.trim() === (props.entry.observationMemo || ''))
watch(() => props.entry, entry => {
  location.value = entry.observationLocation || ''
  memo.value = entry.observationMemo || ''
  saved.value = !!entry.serverSaved
  error.value = ''
}, { immediate: true })

async function save() {
  if (saving.value) return
  const entry = props.entry
  saving.value = true
  error.value = ''
  try {
    const record = await saveObservation(entry, location.value, memo.value)
    if (!mounted || props.entry.id !== entry.id) return
    updateHistory(record)
    emit('saved', record)
    if (props.entry.id === entry.id) saved.value = true
  } catch (cause) {
    if (props.entry.id === entry.id) error.value = cause.message || '관측 기록을 저장하지 못했습니다. 다시 시도해 주세요.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="observation" @submit.prevent="save">
    <h3>관측 기록</h3>
    <label>관측 장소 <span class="faint">(선택)</span>
      <input v-model="location" maxlength="200" :disabled="saving" placeholder="예: 본관 옥상" autocomplete="off" />
    </label>
    <label>메모 <span class="faint">(선택)</span>
      <textarea v-model="memo" maxlength="2000" :disabled="saving" rows="3" placeholder="발견 방향이나 당시 상황을 남겨 주세요." />
    </label>
    <div class="observation__actions">
      <span class="faint">분석 결과와 함께 서버에 저장됩니다.</span>
      <button class="btn-primary" type="submit" :disabled="saving || unchanged">{{ saving ? '저장 중' : unchanged ? '저장 완료' : '관측 기록 저장' }}</button>
    </div>
    <p v-if="error" class="observation__error" role="alert">{{ error }}</p>
    <p v-else-if="unchanged" class="dim" role="status">관측 기록을 저장했습니다. 검출 기록에서 확인할 수 있습니다.</p>
  </form>
</template>

<style scoped>
.observation { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); }
h3, p { margin: 0; font-size: 14px; }
label { display: block; font-size: 12px; }
input, textarea { display: block; box-sizing: border-box; width: 100%; margin-top: 8px; }
textarea { resize: vertical; min-height: 80px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 8px 10px; }
textarea:focus { outline: none; border-color: var(--accent); }
.observation__actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; font-size: 12px; }
p { font-size: 12px; line-height: 1.6; }
.observation__error { color: var(--drone); }
</style>
