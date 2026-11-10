export const TRACKER_PROFILES = [
  { value: 'd0', label: '기존 D0', description: '기존 추적 방식입니다. 언제든 이 옵션으로 돌아갈 수 있습니다.' },
  { value: 'central_v1', label: '지그재그 완화 후보', description: '중심부 특징점의 이동을 측정하고 기존 특징점을 유지합니다. 실험용입니다.' },
  { value: 'central_handoff_v1', label: '지그재그 완화 + 전환 복구 후보', description: '지그재그 완화에 KLT → motion 전환 복구를 추가합니다. 객체 겹침·배경 고정은 여전히 발생할 수 있습니다.' },
]

export function trackerLabel(value) {
  return TRACKER_PROFILES.find((p) => p.value === (value ?? 'd0'))?.label ?? value
}

export function serializeTrackingTuning(tuning) {
  const variant = tuning.trackerVariant ?? 'd0'
  if (!TRACKER_PROFILES.some((p) => p.value === variant)) throw new Error('지원하지 않는 추적 방식입니다.')
  return {
    tracker_variant: variant,
    klt_accept_conf: tuning.kltAcceptConf,
    recovery_conf: tuning.recoveryConf,
    update_conf: tuning.updateConf,
    search_radius_multiplier: tuning.searchRadius,
    online_update_enabled: tuning.onlineUpdate,
  }
}
