import { useCallback, useEffect, useRef, useState } from 'react'

// Relative to the page, so it works under Vite dev (/content, see
// vite.config.js) and on the Pi (~/kiosk/ui/content/).
export const CONTENT_ROOT = 'content/'
const ITEMS_URL = CONTENT_ROOT + 'items.json'

/**
 * Loads items.json. `reload()` is called on every tag arrival so an edited
 * items.json shows up without restarting the browser. A failed or malformed
 * load keeps the last good copy; `status` only reads "error" if we never had one.
 */
export function useContent() {
  const [items, setItems] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const hasGood = useRef(false)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(ITEMS_URL, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object')
      // UIDs are opaque lowercase hex; normalise keys so hand-edited JSON
      // with uppercase still matches.
      const normalised = {}
      for (const [uid, item] of Object.entries(data)) normalised[uid.toLowerCase()] = item
      hasGood.current = true
      setItems(normalised)
      setStatus('ready')
    } catch (err) {
      console.warn('[content] could not load items.json:', err.message)
      if (!hasGood.current) setStatus('error')
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { items: items || {}, status, reload }
}

/**
 * Turn a content-relative media path into a URL. Anything absolute or remote
 * is refused: the case is offline, so a remote URL would only ever break.
 */
export function mediaUrl(path) {
  if (typeof path !== 'string' || !path) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return null
  return CONTENT_ROOT + path.replace(/^\/+/, '')
}

/** Defensive view of an item: whatever is in the JSON, this shape is safe to render. */
export function normaliseItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  return {
    title: typeof item.title === 'string' ? item.title : 'Untitled',
    subtitle: typeof item.subtitle === 'string' ? item.subtitle : '',
    accent: isColour(item.accent) ? item.accent : null,
    sections: Array.isArray(item.sections)
      ? item.sections.filter((s) => s && typeof s === 'object' && typeof s.type === 'string')
      : [],
  }
}

function isColour(v) {
  return typeof v === 'string' && typeof CSS !== 'undefined' && CSS.supports('color', v)
}
