// Drag-to-scroll for input that arrives as a mouse.
//
// QUIRK: on the Pi (labwc/Wayland) the touchscreen can reach Chromium as an
// emulated mouse. Taps still click, but a finger drag is a mouse drag, and
// browsers don't scroll on mouse drags — so the page looks frozen. The case
// has no real mouse, so we treat any non-touch drag as a scroll, with a little
// momentum. Genuine touch input (pointerType "touch") is left to the browser.
//
// Installed once from main.jsx; works for every scroll container (the item
// page, the tag list, gallery strips) by finding the nearest one that can
// scroll in the drag's direction.

const START_PX = 8 // movement before a press becomes a drag (below: a tap)
const FRICTION = 0.94 // momentum decay per frame
const MIN_SPEED = 0.35 // px per ms at which momentum stops
const SAMPLE_MS = 80 // velocity is measured over the last this-many ms

function scrollerFor(el, axis) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (axis === 'y') {
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return n
    } else if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return n
  }
  return null
}

export function installDragScroll() {
  let drag = null // { id, x0, y0, target, axis, el, lastX, lastY, samples }
  let glide = 0

  const stopGlide = () => {
    cancelAnimationFrame(glide)
    glide = 0
  }

  // Each element's own inline snap value, remembered the first time we touch
  // it (a drag that starts mid-glide would otherwise save our "none").
  const ownSnap = new WeakMap()
  const restoreSnap = (el) => {
    if (el && ownSnap.has(el)) el.style.scrollSnapType = ownSnap.get(el)
  }

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      stopGlide()
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, el: null, target: e.target, samples: [] }
    },
    true,
  )

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x0
      const dy = e.clientY - drag.y0
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < START_PX) return
        drag.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
        drag.el = scrollerFor(drag.target, drag.axis)
        if (!drag.el) {
          drag = null
          return
        }
        // Scroll snapping re-snaps after every programmatic scroll, which
        // fights a drag. Off while dragging, back on when it settles.
        if (!ownSnap.has(drag.el)) ownSnap.set(drag.el, drag.el.style.scrollSnapType)
        drag.el.style.scrollSnapType = 'none'
        drag.lastX = e.clientX
        drag.lastY = e.clientY
      }
      const el = drag.el
      if (drag.axis === 'y') el.scrollTop -= e.clientY - drag.lastY
      else el.scrollLeft -= e.clientX - drag.lastX
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      const now = performance.now()
      drag.samples.push([now, drag.axis === 'y' ? e.clientY : e.clientX])
      while (drag.samples.length > 2 && now - drag.samples[0][0] > SAMPLE_MS) drag.samples.shift()
    },
    true,
  )

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    if (!d.axis || !d.el) return

    // It was a drag, not a tap: swallow the click that follows the release.
    const swallow = (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)

    // Momentum: a short, decaying glide. Stops by itself; nothing keeps running.
    const s = d.samples
    let v = 0
    if (s.length >= 2) {
      const [t0, p0] = s[0]
      const [t1, p1] = s[s.length - 1]
      if (t1 > t0) v = (p1 - p0) / (t1 - t0)
    }
    let prev = performance.now()
    const step = (now) => {
      const dt = Math.min(now - prev, 32)
      prev = now
      v *= Math.pow(FRICTION, dt / 16.7)
      if (Math.abs(v) < MIN_SPEED) {
        glide = 0
        restoreSnap(d.el)
        return
      }
      if (d.axis === 'y') d.el.scrollTop -= v * dt
      else d.el.scrollLeft -= v * dt
      glide = requestAnimationFrame(step)
    }
    if (Math.abs(v) >= MIN_SPEED) glide = requestAnimationFrame(step)
    else restoreSnap(d.el)
  }
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}
