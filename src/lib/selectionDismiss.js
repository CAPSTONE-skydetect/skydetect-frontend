export function bindSelectionDismiss(target, { isActive, roots, cancel }) {
  const pointer = event => {
    if (!isActive() || event.button !== 0) return
    const path = event.composedPath?.() || []
    if (roots().some(root => root && (path.includes(root) || root.contains(event.target)))) return
    // Do not consume the click: the outside control must still work normally.
    cancel()
  }
  const key = event => {
    if (isActive() && event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }
  target.addEventListener('pointerdown', pointer, true)
  target.addEventListener('keydown', key, true)
  return () => {
    target.removeEventListener('pointerdown', pointer, true)
    target.removeEventListener('keydown', key, true)
  }
}
