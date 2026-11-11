/**
 * 화면에 그려진 한국어 문구를 영어로 바꿔 보여 주는 번역기.
 *
 * 컴포넌트마다 t() 를 박는 대신, 그려진 글자(텍스트 노드와 title / aria-label / placeholder)를
 * 문구표(koEn.js)로 바꾼다. 문구표에 없는 글자는 그대로 둔다.
 *
 *   - 영어를 고르면 지금 있는 글자를 모두 바꾸고, 이후 Vue 가 새로 그리거나 고치는 글자도
 *     MutationObserver 로 따라 바꾼다.
 *   - 한국어로 되돌리면 바꾼 글자를 원래대로 되돌린다. 원래 글자는 노드마다 기억해 둔다.
 *   - 우리가 넣은 영어가 다시 변화 감지에 걸려도 한국어가 없어 아무 일도 하지 않으므로 무한 반복하지 않는다.
 *   - 스크립트와 스타일 안의 글자는 건드리지 않는다.
 */
import { watch } from 'vue'
import { useLocale } from '../composables/useLocale.js'
import { EXACT, PATTERNS } from './koEn.js'

const KOREAN = /[가-힣]/
const ATTRS = ['title', 'aria-label', 'placeholder']

/** 한 문구를 영어로. 못 바꾸면 null. */
export function translate(text) {
  const trimmed = text.trim()
  if (!trimmed || !KOREAN.test(trimmed)) return null
  const lead = text.slice(0, text.indexOf(trimmed))
  const tail = text.slice(lead.length + trimmed.length)

  let out = EXACT[trimmed]
  if (out === undefined) {
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(trimmed)) {
        out = trimmed.replace(pattern, replacement)
        break
      }
    }
  }
  if (out === undefined) return null
  // 문구 안에 남은 한국어 조각(판정 라벨 등)을 한 번 더 바꾼다.
  if (KOREAN.test(out)) {
    out = out.replace(/[가-힣][가-힣 ]*[가-힣]|[가-힣]/g, (piece) => EXACT[piece] ?? piece)
  }
  return lead + out + tail
}

export function startDomTranslate(root) {
  if (!root) return () => {}
  const { locale } = useLocale()

  /** 바꾼 텍스트 노드 → { src: 원래 글자, out: 바꾼 글자 } */
  const textNodes = new Map()
  /** 바꾼 속성 → 요소 → { 속성명: { src, out } } */
  const attrNodes = new Map()

  function shouldSkip(node) {
    const tag = node.parentElement?.tagName
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA'
  }

  function applyText(node) {
    if (shouldSkip(node)) return
    const known = textNodes.get(node)
    if (known && node.nodeValue === known.out) return   // 우리가 넣은 글자
    const out = translate(node.nodeValue)
    if (out === null) {
      if (known) textNodes.delete(node)                  // Vue 가 다른 글자로 바꿔 놓았고 문구표에도 없다
      return
    }
    textNodes.set(node, { src: node.nodeValue, out })
    node.nodeValue = out
  }

  function applyAttrs(el) {
    for (const name of ATTRS) {
      const value = el.getAttribute?.(name)
      if (!value) continue
      const known = attrNodes.get(el)?.[name]
      if (known && value === known.out) continue
      const out = translate(value)
      if (out === null) continue
      const record = attrNodes.get(el) || {}
      record[name] = { src: value, out }
      attrNodes.set(el, record)
      el.setAttribute(name, out)
    }
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) { applyText(node); return }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    applyAttrs(node)
    for (const child of node.childNodes) walk(child)
  }

  function revert() {
    for (const [node, { src, out }] of textNodes) {
      if (node.isConnected && node.nodeValue === out) node.nodeValue = src
    }
    textNodes.clear()
    for (const [el, record] of attrNodes) {
      if (!el.isConnected) continue
      for (const [name, { src, out }] of Object.entries(record)) {
        if (el.getAttribute(name) === out) el.setAttribute(name, src)
      }
    }
    attrNodes.clear()
  }

  /** 화면에서 사라진 노드는 기록에서도 지워 메모리를 붙들고 있지 않게 한다. */
  function prune() {
    for (const node of textNodes.keys()) if (!node.isConnected) textNodes.delete(node)
    for (const el of attrNodes.keys()) if (!el.isConnected) attrNodes.delete(el)
  }

  const observer = new MutationObserver((records) => {
    if (locale.value !== 'en') return
    for (const record of records) {
      if (record.type === 'characterData') applyText(record.target)
      else if (record.type === 'attributes') applyAttrs(record.target)
      else for (const node of record.addedNodes) walk(node)
    }
    if (textNodes.size > 2000) prune()
  })

  function enable() {
    walk(root)
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    })
  }

  function disable() {
    observer.disconnect()
    revert()
  }

  const stop = watch(locale, (value) => (value === 'en' ? enable() : disable()), { immediate: true })

  return () => {
    stop()
    disable()
  }
}
