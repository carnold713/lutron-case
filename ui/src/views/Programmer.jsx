import { useEffect, useRef, useState } from 'react'
import { KIND_LABELS, normaliseItem } from '../content.js'

// Tag programming: put a tag on the pad, pick the page it should open.
// The mapping is saved on the case (kiosk_server.py -> ~/kiosk/data/tags.json);
// the tag itself is never written to — any blank NTAG sticker works, because
// what we associate is its fixed factory UID.

// Leave programming mode on its own if nobody touches it, so the case can't be
// left in it at a demo.
const PROGRAM_IDLE_TIMEOUT_MS = 180_000

export default function Programmer({ uid, at, items, targetOf, assign, alsoInRange, onDone }) {
  const [saving, setSaving] = useState(null) // content id being saved
  const [message, setMessage] = useState(null) // { ok, text }
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const idleTimer = useRef(null)
  const listRef = useRef(null)

  const poke = () => {
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => doneRef.current(), PROGRAM_IDLE_TIMEOUT_MS)
  }
  useEffect(() => {
    poke()
    return () => clearTimeout(idleTimer.current)
  }, [])

  // New tag on the pad: fresh state, list back to the top.
  useEffect(() => {
    setMessage(null)
    setSaving(null)
    listRef.current?.scrollTo({ top: 0 })
    poke()
  }, [uid])

  const current = uid ? targetOf(uid) : null
  const currentItem = current && items[current] ? normaliseItem(items[current]) : null
  const groups = groupByKind(items)

  const save = async (id) => {
    if (!uid || saving) return
    setSaving(id ?? '')
    setMessage(null)
    try {
      await assign(uid, id)
      const title = id ? normaliseItem(items[id]).title : null
      setMessage({ ok: true, text: title ? `Saved — this tag now opens ${title}.` : 'Saved — this tag is unassigned.' })
    } catch {
      setMessage({ ok: false, text: 'Couldn’t save. Is the kiosk server running?' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className="view programmer" onPointerDown={poke}>
      <header className="prog-head">
        <h1 className="prog-title">Program tags</h1>
        <button className="btn btn-small" onClick={onDone}>
          Done
        </button>
      </header>

      {!uid ? (
        <div className="prog-wait">
          <div className="unknown-mark" aria-hidden="true" />
          <p className="prog-wait-title">Place a tag on the pad</p>
          <p className="prog-wait-sub">Any NTAG sticker works. You can then choose which page it opens.</p>
        </div>
      ) : (
        <>
          <section className="prog-tag">
            <div className="uid-label">Tag on the pad</div>
            <div className="uid-value">{groupHex(uid)}</div>
            <div className="prog-current">
              {currentItem ? (
                <>
                  Opens <strong>{currentItem.title}</strong>
                </>
              ) : current ? (
                <>Assigned to “{current}”, which isn’t in items.json</>
              ) : (
                'Not assigned yet — pick a page below'
              )}
            </div>
            {message && <div className={`prog-msg${message.ok ? '' : ' is-error'}`}>{message.text}</div>}
            {alsoInRange && alsoInRange !== uid && (
              // Two tags in the reader's field make it alternate between them;
              // on a demo that flips the screen back and forth.
              <div className="prog-warn">
                Another tag is also in range ({groupHex(alsoInRange)}). Remove it if it isn’t meant to be there —
                with two tags on the pad the reader switches between them.
              </div>
            )}
            {current && (
              <button className="btn btn-small btn-quiet" onClick={() => save(null)} disabled={saving !== null}>
                Unassign
              </button>
            )}
          </section>

          <div className="prog-list" ref={listRef}>
            {groups.map(([kind, entries]) => (
              <section key={kind}>
                <h2 className="s-heading prog-kind">{KIND_LABELS[kind] || kind}</h2>
                {entries.map(([id, it]) => (
                  <button
                    key={id}
                    className={`prog-row${id === current ? ' is-current' : ''}`}
                    onClick={() => save(id)}
                    disabled={saving !== null}
                  >
                    <span className="prog-row-text">
                      <span className="prog-row-title">{it.title}</span>
                      <span className="prog-row-sub">{it.subtitle || id}</span>
                    </span>
                    <span className="prog-row-mark" aria-hidden="true">
                      {saving === id ? '…' : id === current ? '✓' : ''}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {!groups.length && <p className="prog-wait-sub">No pages in content/items.json yet.</p>}
          </div>
        </>
      )}
    </main>
  )
}

// [[kind, [[id, item], …]], …] — kinds in KIND_LABELS order first, then others.
function groupByKind(items) {
  const byKind = new Map()
  for (const [id, raw] of Object.entries(items)) {
    const it = normaliseItem(raw)
    if (!byKind.has(it.kind)) byKind.set(it.kind, [])
    byKind.get(it.kind).push([id, it])
  }
  const order = Object.keys(KIND_LABELS)
  return [...byKind.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map(([k, list]) => [k, list.sort((a, b) => a[1].title.localeCompare(b[1].title))])
}

const groupHex = (s) => String(s).match(/.{1,4}/g)?.join(' ') ?? String(s)
