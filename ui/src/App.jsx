import { useCallback, useEffect, useRef, useState } from 'react'
import useHardware from './useHardware.js'
import { useContent } from './content.js'
import Idle from './views/Idle.jsx'
import Item from './views/Item.jsx'
import Unknown from './views/Unknown.jsx'
import Admin from './views/Admin.jsx'
import Programmer from './views/Programmer.jsx'

// After a tag is lifted, keep its content up this long so people can finish
// reading, then fall back to idle.
export const HOLD_AFTER_REMOVAL_MS = 60_000

// Two tags in range at once (seen on the case: a sticker plus a 4-byte card
// on the same product). The PN532 reports them alternately, ~1s apart, as
// separate "tag" messages. Keep what's showing, and only move to the newcomer
// if the current tag stops being reported for this long.
const STRAY_WINDOW_MS = 2500

// ?tag=<uid> opens whatever that tag is assigned to, as if it were sitting on
// the pad. ?tag=<content id> (e.g. ?tag=pico) opens a page directly.
const URL_TAG = new URLSearchParams(window.location.search).get('tag')?.toLowerCase() || null

export default function App() {
  const { items, status, reload, resolve, targetOf, assign } = useContent()
  // uid: what's on screen (null = idle). present: is it still on the pad.
  const [tag, setTag] = useState(() => ({ uid: URL_TAG, at: null, present: !!URL_TAG }))
  // Bumped whenever the hold countdown restarts, so its progress bar restarts.
  const [holdEpoch, setHoldEpoch] = useState(0)
  const [admin, setAdmin] = useState(false)
  // Tag programming mode: tags go to the programmer instead of opening pages.
  const [programming, setProgramming] = useState(null) // null | { uid, at }
  const holdTimer = useRef(null)
  const tagRef = useRef(tag)
  tagRef.current = tag
  const programmingRef = useRef(programming)
  programmingRef.current = programming
  // A newcomer tag waiting to see if it's a stray (see STRAY_WINDOW_MS).
  const pending = useRef(null)
  // For the programmer: another tag was seen alongside the one being programmed.
  const [alsoInRange, setAlsoInRange] = useState(null)

  const cancelPending = () => {
    clearTimeout(pending.current)
    pending.current = null
  }

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

  useEffect(
    () => () => {
      clearHold()
      cancelPending()
    },
    [],
  )

  // Act on a tag: open its page, or hand it to the programmer.
  const applyTag = (uid, at) => {
    if (programmingRef.current) {
      reload()
      setAlsoInRange(null)
      setProgramming({ uid, at: at || null })
      return
    }
    clearHold()
    reload() // pick up content edits without a browser restart
    // A different uid remounts the item view (keyed by uid), which resets scroll.
    setTag({ uid, at: at || null, present: true })
    setAdmin(false)
  }

  const hw = useHardware({
    onTag(uid, at) {
      const prog = programmingRef.current
      const cur = prog ? prog.uid : tagRef.current.present ? tagRef.current.uid : null
      if (uid === cur) {
        // The current tag is still there: whatever arrived in between was a stray.
        cancelPending()
        return
      }
      // Contested: something is already on the pad, and the newcomer shouldn't
      // take over outright — in the programmer (never swap mid-programming),
      // or when a known product is showing and the newcomer is unknown.
      // A known newcomer replaces a known product at once (a product swap).
      const contested = cur && (prog || (resolve(cur) && !resolve(uid)))
      cancelPending()
      if (contested) {
        if (prog) setAlsoInRange(uid)
        pending.current = setTimeout(() => {
          pending.current = null
          applyTag(uid, at)
        }, STRAY_WINDOW_MS)
        return
      }
      applyTag(uid, at)
    },
    onTagGone() {
      cancelPending()
      setAlsoInRange(null)
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
      setProgramming(null)
    },
  })

  const startProgramming = () => {
    clearHold()
    setTag({ uid: null, at: null, present: false })
    setAdmin(false)
    setProgramming({ uid: null, at: null })
    reload()
  }

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
  const item = tag.uid ? resolve(tag.uid) : null
  if (programming) {
    view = (
      <Programmer
        uid={programming.uid}
        at={programming.at}
        items={items}
        targetOf={targetOf}
        assign={assign}
        alsoInRange={alsoInRange}
        onDone={() => {
          cancelPending()
          setAlsoInRange(null)
          setProgramming(null)
        }}
      />
    )
  } else if (admin) {
    view = (
      <Admin
        onCancel={() => setAdmin(false)}
        onProgram={startProgramming}
        onShutdown={() => hw.send({ type: 'shutdown' })}
      />
    )
  } else if (!tag.uid) {
    view = <Idle light={hw.light} climate={hw.climate} onAdmin={() => setAdmin(true)} />
  } else if (status === 'loading') {
    // Content still loading at boot: stay on idle for the moment it takes.
    view = <Idle light={hw.light} climate={hw.climate} />
  } else if (item) {
    view = (
      <Item
        key={tag.uid}
        raw={item}
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
      {tag.uid && !admin && !programming && (
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
