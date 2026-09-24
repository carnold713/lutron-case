import { useCallback, useEffect, useRef, useState } from 'react'

// The single place in the UI that knows about WebSockets.
// Contract (see BRIEF.md): hardware.py pushes JSON messages
//   light {kelvin, lux, brightness}   every 250ms
//   tag {uid, at}                     once per arrival
//   tag-gone                          tag lifted off the pad
//   wake / sleep                      screen state (also sent on connect)
//   climate {celsius, humidity}       reserved for the SHT41 (not wired yet)
// and accepts {type: "shutdown"}.

export const WS_URL = 'ws://localhost:8765'
const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 5000
// Don't flash the "offline" dot for blips (or during the first connect at boot).
const OFFLINE_INDICATOR_DELAY_MS = 3000
// Readings arrive at 4Hz. Only re-render when the rounded value actually
// changes, so the idle screen isn't repainting for sensor noise.
const KELVIN_STEP = 50
const LUX_STEP = 1

const roundTo = (v, step) => (Number.isFinite(v) ? Math.round(v / step) * step : null)

/**
 * @param {object} handlers  { onTag(uid, at), onTagGone(), onWake(), onSleep() }
 * @returns {{ online: boolean, light: {kelvin, lux}|null, climate: object|null,
 *             awake: boolean, send: (msg) => void }}
 */
export default function useHardware(handlers) {
  const [online, setOnline] = useState(true)
  const [light, setLight] = useState(null)
  const [climate, setClimate] = useState(null)
  const [awake, setAwake] = useState(true)
  const wsRef = useRef(null)

  // Handlers change every render; keep the latest without reconnecting.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let closed = false
    let retryTimer = null
    let offlineTimer = null
    let delay = RECONNECT_MIN_MS

    const markOffline = () => {
      if (!offlineTimer) offlineTimer = setTimeout(() => setOnline(false), OFFLINE_INDICATOR_DELAY_MS)
    }
    const markOnline = () => {
      clearTimeout(offlineTimer)
      offlineTimer = null
      setOnline(true)
    }

    const dispatch = (msg) => {
      const h = handlersRef.current || {}
      switch (msg.type) {
        case 'light': {
          const kelvin = roundTo(msg.kelvin, KELVIN_STEP)
          const lux = roundTo(msg.lux, LUX_STEP)
          setLight((prev) =>
            prev && prev.kelvin === kelvin && prev.lux === lux ? prev : { kelvin, lux },
          )
          break
        }
        case 'climate':
          setClimate({ celsius: msg.celsius, humidity: msg.humidity })
          break
        case 'tag':
          if (typeof msg.uid === 'string' && msg.uid) h.onTag?.(msg.uid.toLowerCase(), msg.at)
          break
        case 'tag-gone':
          h.onTagGone?.()
          break
        case 'wake':
          setAwake(true)
          h.onWake?.()
          break
        case 'sleep':
          setAwake(false)
          h.onSleep?.()
          break
        default:
        // Unknown message types are ignored: the contract grows by addition.
      }
    }

    const connect = () => {
      if (closed) return
      let ws
      try {
        ws = new WebSocket(WS_URL)
      } catch {
        return scheduleRetry()
      }
      wsRef.current = ws
      ws.onopen = () => {
        delay = RECONNECT_MIN_MS
        markOnline()
      }
      ws.onmessage = (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (msg && typeof msg === 'object') dispatch(msg)
      }
      // onerror is always followed by onclose; retry from there only.
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        scheduleRetry()
      }
    }

    const scheduleRetry = () => {
      if (closed) return
      markOffline()
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      clearTimeout(offlineTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  const send = useCallback((msg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  return { online, light, climate, awake, send }
}
