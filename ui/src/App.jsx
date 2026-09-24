import { useCallback, useEffect, useRef, useState } from 'react'
import useHardware from './useHardware.js'
import { useContent } from './content.js'
import Idle from './views/Idle.jsx'
import Item from './views/Item.jsx'
import Unknown from './views/Unknown.jsx'
import Admin from './views/Admin.jsx'

// After a tag is lifted, keep its content up this long so people can finish
// reading, then fall back to idle.
export const HOLD_AFTER_REMOVAL_MS = 60_000

// ?tag=<uid> opens an item directly (dev, or for checking content in a
// browser). It behaves as if that tag is sitting on the pad.
const URL_TAG = new URLSearchParams(window.location.search).get('tag')?.toLowerCase() || null

export default function App() {
  const { items, status, reload } = useContent()
  // uid: what's on screen (null = idle). present: is it still on the pad.
  const [tag, setTag] = useState(() => ({ uid: URL_TAG, at: null, present: !!URL_TAG }))
  // Bumped whenever the hold countdown restarts, so its progress bar restarts.
  const [holdEpoch, setHoldEpoch] = useState(0)
  const [admin, setAdmin] = useState(false)
  const holdTimer = useRef(null)
  const tagRef = useRef(tag)
  tagRef.current = tag

  const clearHold = () => {
    clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  const startHold = useCallback(() => {
    clearHold()
    setHoldEpoch((n) => n + 1)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      setTag({ uid: null, at: null, present: false })
    }, HOLD_AFTER_REMOVAL_MS)
  }, [])

  useEffect(() => clearHold, [])

  const hw = useHardware({
    onTag(uid, at) {
      clearHold()
      reload() // pick up content edits without a browser restart
      // A different uid remounts the item view (keyed by uid), which resets scroll.
      setTag({ uid, at: at || null, present: true })
      setAdmin(false)
    },
    onTagGone() {
      if (!tagRef.current.uid) return
      setTag((t) => ({ ...t, present: false }))
      startHold()
    },
    onSleep() {
      // The screen is off; nobody is reading. If nothing is on the pad, drop
      // straight back to idle so the next wake starts clean.
      if (!tagRef.current.present) {
        clearHold()
        setTag({ uid: null, at: null, present: false })
      }
      setAdmin(false)
    },
  })

  // Back button: straight to idle. If the product is still on the pad it stays
  // dismissed — the reader only reports a tag once per arrival, so lifting and
  // setting it down again brings it back.
  const goIdle = () => {
    clearHold()
    setTag({ uid: null, at: null, present: false })
  }

  // While a lifted item is being held, touching the screen means someone is
  // still reading: restart the countdown rather than yank it away.
  const holding = !!tag.uid && !tag.present
  const onInteract = holding ? startHold : undefined

  let view
  if (admin) {
    view = <Admin onCancel={() => setAdmin(false)} onShutdown={() => hw.send({ type: 'shutdown' })} />
  } else if (!tag.uid) {
    view = <Idle light={hw.light} climate={hw.climate} onAdmin={() => setAdmin(true)} />
  } else if (status === 'loading') {
    // Content still loading at boot: stay on idle for the moment it takes.
    view = <Idle light={hw.light} climate={hw.climate} />
  } else if (items[tag.uid]) {
    view = (
      <Item
        key={tag.uid}
        raw={items[tag.uid]}
        holding={holding}
        holdEpoch={holdEpoch}
        holdMs={HOLD_AFTER_REMOVAL_MS}
        onInteract={onInteract}
      />
    )
  } else {
    view = <Unknown key={tag.uid} uid={tag.uid} at={tag.at} contentMissing={status === 'error'} />
  }

  return (
    <div className="app">
      {view}
      {tag.uid && !admin && (
        <button className="back-btn" onClick={goIdle} aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}
      <div className={`offline-dot${hw.online ? '' : ' is-offline'}`} aria-hidden="true" />
    </div>
  )
}
