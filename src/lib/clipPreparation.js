export function clipPreparation(clips, now) {
  const pending = clips.filter(clip => clip.status === 'PENDING')
  const latest = pending.reduce((a, b) => !a || b.triggeredAt > a.triggeredAt ? b : a, null)
  if (!latest) return null
  const elapsed = Math.max(0, (now - latest.triggeredAt) / 1000)
  const remaining = Number.isFinite(latest.readyAt) ? Math.max(0, (latest.readyAt - Math.max(now, latest.triggeredAt)) / 1000) : null
  return { clipId: latest.clipId, count: pending.length, elapsed, remaining,
    phase: remaining === null ? 'preparing' : remaining > 0 ? 'waiting' : 'processing' }
}
