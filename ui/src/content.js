import { useCallback, useEffect, useRef, useState } from 'react'

// Relative to the page, so it works under Vite dev (/content, see
// vite.config.js) and on the Pi (~/kiosk/ui/content/).
export const CONTENT_ROOT = 'content/'
const ITEMS_URL = CONTENT_ROOT + 'items.json'
// Tag -> content mapping that ships with the repo (content/tags.json)…
const REPO_TAGS_URL = CONTENT_ROOT + 'tags.json'
// …and assignments made on the case itself (kiosk_server.py / vite dev
// middleware). Local wins; a null value means "explicitly unassigned".
const LOCAL_TAGS_URL = 'api/tags'

// How kinds are labelled in the tag-programming list. Unknown kinds are
// shown under their own name, so a new kind is just a new value in items.json.
export const KIND_LABELS = { product: 'Products', material: 'Materials' }

/**
 * Loads items.json plus both tag maps. `reload()` runs on every tag arrival so
 * edits show up without restarting the browser. A failed or malformed load
 * keeps the last good copy; `status` only reads "error" if we never had one.
 *
 * items.json is keyed by content id ("pico", "satin-nickel"); tags map a tag
 * UID to one of those ids. Items keyed directly by a UID still work.
 */
export function useContent() {
  const [items, setItems] = useState(null)
  const [repoTags, setRepoTags] = useState({})
  const [localTags, setLocalTags] = useState({})
  const [status, setStatus] = useState('loading') // loading | ready | error
  const hasGood = useRef(false)

  const reload = useCallback(async () => {
    const [itemsRes, repoRes, localRes] = await Promise.allSettled([
      fetchJson(ITEMS_URL),
      fetchJson(REPO_TAGS_URL),
      fetchJson(LOCAL_TAGS_URL),
    ])
    if (itemsRes.status === 'fulfilled') {
      const normalised = {}
      for (const [id, item] of Object.entries(itemsRes.value)) normalised[id.toLowerCase()] = item
      hasGood.current = true
      setItems(normalised)
      setStatus('ready')
    } else {
      console.warn('[content] could not load items.json:', itemsRes.reason?.message)
      if (!hasGood.current) setStatus('error')
    }
    // A missing or broken tag file just means "no mappings from there".
    if (repoRes.status === 'fulfilled') setRepoTags(lowerKeys(repoRes.value))
    if (localRes.status === 'fulfilled') setLocalTags(lowerKeys(localRes.value))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const tags = { ...repoTags, ...localTags }
  const all = items || {}

  /** Content id a tag opens, or null. */
  const targetOf = (uid) => {
    if (Object.prototype.hasOwnProperty.call(tags, uid)) return tags[uid] ? String(tags[uid]).toLowerCase() : null
    return all[uid] ? uid : null // legacy: item keyed by the UID itself
  }
  /** The item a tag opens, or null. */
  const resolve = (uid) => {
    const id = targetOf(uid)
    return id && all[id] ? all[id] : null
  }

  /** Save an assignment on the case. Throws if the server refused it. */
  const assign = useCallback(async (uid, target) => {
    const res = await fetch(LOCAL_TAGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, target }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setLocalTags((t) => ({ ...t, [uid]: target }))
  }, [])

  return { items: all, status, reload, resolve, targetOf, assign }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object')
  return data
}

const lowerKeys = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]))

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
    kind: typeof item.kind === 'string' ? item.kind : 'product',
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
