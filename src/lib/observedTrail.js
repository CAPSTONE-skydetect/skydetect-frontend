export function observedTrailSegments(points, untilFrame) {
  const segments = []
  let current = [], previous = null
  for (const point of points) {
    if (point.frameIndex > untilFrame) break
    if (!point.visible || (previous !== null && point.frameIndex !== previous + 1)) {
      if (current.length) segments.push(current)
      current = []
    }
    if (point.visible) current.push(point)
    previous = point.frameIndex
  }
  if (current.length) segments.push(current)
  return segments
}
