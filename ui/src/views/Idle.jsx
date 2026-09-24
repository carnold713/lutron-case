import { useEffect, useRef, useState } from 'react'

// OLED burn-in guard: the idle screen can sit unchanged for hours, so nudge
// the whole composition a few pixels now and then. A timer, not an animation
// loop — the GPU is idle between moves.
const DRIFT_EVERY_MS = 90_000
const DRIFT_MAX_PX = 10
// Hidden admin control: press and hold the ambient readout this long.
const ADMIN_HOLD_MS = 3000

export default function Idle({ light, climate, onAdmin }) {
  const [drift, setDrift] = useState({ x: 0, y: 0 })
  const holdTimer = useRef(null)

  useEffect(() => {
    const id = setInterval(() => {
      const r = () => Math.round((Math.random() * 2 - 1) * DRIFT_MAX_PX)
      setDrift({ x: r(), y: r() })
    }, DRIFT_EVERY_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const startAdminHold = () => {
    if (!onAdmin) return
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(onAdmin, ADMIN_HOLD_MS)
  }
  const cancelAdminHold = () => clearTimeout(holdTimer.current)

  const kelvin = light?.kelvin
  const glow = Number.isFinite(kelvin) && kelvin > 0 ? kelvinToRgb(kelvin) : null

  return (
    <main className="view idle" style={{ '--drift-x': `${drift.x}px`, '--drift-y': `${drift.y}px` }}>
      <div className="idle-inner">
        <div className="idle-pad" style={glow ? { '--glow': glow } : undefined} aria-hidden="true">
          <div className="idle-pad-ring" />
        </div>

        <h1 className="idle-title">Set a product down</h1>
        <p className="idle-sub">Place it on the pad to learn more</p>

        <div
          className="ambient"
          onPointerDown={startAdminHold}
          onPointerUp={cancelAdminHold}
          onPointerLeave={cancelAdminHold}
          onPointerCancel={cancelAdminHold}
        >
          <Reading label="Colour temp" value={fmtKelvin(kelvin)} unit="K" />
          <Reading label="Light" value={fmtLux(light?.lux)} unit="lux" />
          {climate && Number.isFinite(climate.humidity) && (
            <Reading label="Humidity" value={Math.round(climate.humidity)} unit="%" />
          )}
        </div>
      </div>
    </main>
  )
}

function Reading({ label, value, unit }) {
  return (
    <div className="reading">
      <div className="reading-value">
        {value}
        {value !== '—' && <span className="reading-unit">{unit}</span>}
      </div>
      <div className="reading-label">{label}</div>
    </div>
  )
}

const fmtKelvin = (k) => (Number.isFinite(k) && k > 0 ? k.toLocaleString('en-US') : '—')
const fmtLux = (l) => (Number.isFinite(l) && l >= 0 ? Math.round(l).toLocaleString('en-US') : '—')

// Approximate black-body colour for a colour temperature (Tanner Helland's
// fit). Only used to tint the pad glow, so close enough is fine.
function kelvinToRgb(k) {
  const t = Math.min(Math.max(k, 1000), 40000) / 100
  const clamp = (v) => Math.round(Math.min(255, Math.max(0, v)))
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return `rgb(${clamp(r)} ${clamp(g)} ${clamp(b)})`
}
