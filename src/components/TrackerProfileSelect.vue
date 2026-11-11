<script setup>
import { TRACKER_PROFILES } from '../lib/trackerProfiles.js'
defineProps({ modelValue: { type: String, default: 'd0' }, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>

<template>
  <label class="tracker-profile">
    <span>추적 방식 (A)</span>
    <select aria-label="추적 방식 (A)" :value="modelValue" :disabled="disabled"
      @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="profile in TRACKER_PROFILES" :key="profile.value" :value="profile.value">
        {{ profile.label }}
      </option>
    </select>
    <small class="faint">{{ TRACKER_PROFILES.find(p => p.value === modelValue)?.description }}</small>
  </label>
</template>

<style scoped>
.tracker-profile { display: flex; flex-direction: column; gap: 6px; font-size: 12px; min-width: 0; }
.tracker-profile select { width: 100%; min-width: 0; }
.tracker-profile small { line-height: 1.5; max-width: 430px; }
</style>
