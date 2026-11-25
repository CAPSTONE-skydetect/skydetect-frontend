/** 구간 점수 절댓값 총합에서 각 판정 방향이 차지하는 비중. */
export function scoreShare(scores) {
  if (!Array.isArray(scores) || !scores.length || !scores.every(Number.isFinite)) return null
  // 큰 점수도 덧셈이 넘치지 않도록 동일한 척도로 계산한다.
  const scale = scores.reduce((largest, score) => Math.max(largest, Math.abs(score)), 0)
  if (!scale) return null
  let drone = 0
  let bird = 0
  for (const score of scores) {
    if (score > 0) drone += score / scale
    else bird -= score / scale
  }
  const dronePercent = Math.round(drone / (drone + bird) * 100)
  return { dronePercent, birdPercent: 100 - dronePercent, droneSum: drone * scale, birdSum: bird * scale }
}
