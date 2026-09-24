import { useEffect, useRef, useState } from 'react'

// Reached by holding the idle screen's ambient readout. Falls back to idle on
// its own so a curious visitor can't leave it up.
const ADMIN_AUTO_CANCEL_MS = 15_000

export default function Admin({ onCancel, onShutdown }) {
  const [stopping, setStopping] = useState(false)
  // The parent re-renders on every light reading; don't let that restart the timer.
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    if (stopping) return
    const id = setTimeout(() => cancelRef.current(), ADMIN_AUTO_CANCEL_MS)
    return () => clearTimeout(id)
  }, [stopping])

  if (stopping) {
    return (
      <main className="view admin">
        <p className="admin-note">Shutting down… give it ten seconds before closing the lid.</p>
      </main>
    )
  }

  return (
    <main className="view admin">
      <h1 className="admin-title">Case controls</h1>
      <button
        className="btn btn-danger"
        onClick={() => {
          setStopping(true)
          onShutdown()
        }}
      >
        Power off
      </button>
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
    </main>
  )
}
