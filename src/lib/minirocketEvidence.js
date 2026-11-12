const names = { bird: '새', drone: '드론' }
export function minirocketEvidence(analysis) {
  const scores = Array.isArray(analysis.windowScores) ? analysis.windowScores : []
  const offset = analysis.trackStartS
  const windows = scores.flatMap((score, index) => {
    if (!Number.isFinite(score)) return []
    const relative = analysis.windowStartsS?.[index]
    const start = Number.isFinite(offset) && offset >= 0 && Number.isFinite(relative) && relative >= 0 ? offset + relative : null
    return [{ index, score, start, end: start === null ? null : start + 2 }]
  })
  const drone = windows.filter(w => w.score > 0).length
  const bird = windows.filter(w => w.score < 0).length
  const neutral = windows.length - drone - bird
  const name = names[analysis.label]
  const asName = name === '드론' ? '드론으로' : '새로'
  let summary
  if (!name) summary = '새와 드론 중 하나로 확정하지 않고 판정을 보류했습니다.'
  else if (!windows.length) summary = `${asName} 분류했지만, 이 결과에는 구간별 근거가 없습니다.`
  else if (drone && bird) summary = `${asName} 분류했지만, 구간별 판단 방향은 엇갈렸습니다.`
  else if (neutral === windows.length) summary = `${asName} 분류했지만, 구간 점수는 모두 판정 경계에 있습니다.`
  else if ((analysis.label === 'drone' && bird) || (analysis.label === 'bird' && drone)) summary = '최종 판정과 구간별 점수 방향이 달라 결과 확인이 필요합니다.'
  else if (neutral) summary = `${asName} 분류했으며, 일부 구간은 판정 경계에 있습니다.`
  else summary = `${asName} 분류했으며, ${windows.length === 1 ? '사용된 한 구간도' : '사용된 구간들은'} ${name} 방향의 점수를 냈습니다.`
  const ranked = windows.filter(w => !name || (analysis.label === 'drone' ? w.score > 0 : w.score < 0))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.index - b.index).slice(0, 2)
  const representatives = [
    { side: 'drone', name: '드론', window: windows.filter(w => w.score > 0).sort((a, b) => b.score - a.score)[0] || null },
    { side: 'bird', name: '새', window: windows.filter(w => w.score < 0).sort((a, b) => a.score - b.score)[0] || null },
  ]
  let coveredSeconds = null
  if (windows.length && windows.every(w => w.start !== null) && windows.length === scores.length
      && (analysis.windowsUsed == null || analysis.windowsUsed === windows.length)) {
    let end = -Infinity
    coveredSeconds = 0
    for (const w of [...windows].sort((a, b) => a.start - b.start)) {
      coveredSeconds += Math.max(0, w.end - Math.max(w.start, end))
      end = Math.max(end, w.end)
    }
  }
  return { summary, windows, drone, bird, neutral, ranked, representatives, coveredSeconds, decided: !!name,
    rankTitle: name ? `${name} 방향 기여가 큰 구간` : '점수 크기가 큰 검토 구간' }
}

export function trackingQuality(quality) {
  const ratio = quality?.missingRatio
  return {
    points: Number.isInteger(quality?.numPoints) && quality.numPoints >= 0 ? `${quality.numPoints}프레임` : '정보 없음',
    missing: Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? `${(ratio * 100).toFixed(1)}%` : '정보 없음',
    stability: { good: '양호', fair: '보통', poor: '불량' }[quality?.trackStability] || '정보 없음',
  }
}
