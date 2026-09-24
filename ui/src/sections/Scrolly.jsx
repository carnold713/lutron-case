import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mediaUrl } from '../content.js'

// { "type": "scrolly",
//   "object": { "src": "media/pico/pico.svg", "width": 0.222, "aspect": 0.5 },
//   "scenes": [ {
//       "kicker": "…", "headline": "…", "body": "…", "align": "center", "copyY": 0.11,
//       "object": { "x": 0.5, "y": 0.65, "scale": 1.15, "rotate": -8 },
//       "glow":   { "x": 0.5, "y": 0.68, "size": 0.83, "color": "#FFB347", "opacity": 0.32 },
//       "extras": [ { "type": "callouts" | "highlight" | "rings" | "meter" | "badge" | "mounts" | "hint", … } ]
//   }, … ] }
//
// Scrollytelling: each scene is one screen of scrolling. A sticky stage holds
// the object, which moves/scales/rotates between scene states as you scroll;
// each scene's copy and extras fade and slide in around their scene.
// Positions are fractions of the stage (x of width, y of height; sizes of
// width), so the Figma frames (1080×1920) translate directly: x = px / 1080.
//
// Battery: nothing runs unless the page is scrolling. Updates are rAF-throttled
// and only write transform/opacity, which the compositor handles without
// repainting. Glows cross-fade (one per scene) instead of animating colour.

const HOLD = 0.2 // fraction of each scene's scroll where the object sits still
const COPY_TRAVEL = 0.12 // how far copy slides, as a fraction of stage height
const COPY_FADE = 2.5 // copy is gone 0.4 of a scene away, so neighbours never overlap

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const num = (v, d) => (Number.isFinite(v) ? v : d)
const smooth = (t) => t * t * (3 - 2 * t)
const settle = (f) => smooth(clamp((f - HOLD) / (1 - 2 * HOLD)))
const lerp = (a, b, t) => a + (b - a) * t

function sceneObject(s) {
  const o = s.object || {}
  return { x: num(o.x, 0.5), y: num(o.y, 0.6), scale: num(o.scale, 1), rotate: num(o.rotate, 0) }
}

export default function Scrolly({ section }) {
  const scenes = Array.isArray(section.scenes) ? section.scenes.filter((s) => s && typeof s === 'object') : []
  const obj = section.object || {}
  const src = mediaUrl(obj.src)
  const baseW = num(obj.width, 0.22)
  const aspect = num(obj.aspect, 0.5) // width / height

  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const objRef = useRef(null)
  const glowRefs = useRef([])
  // Per scene: the layer under the object (bases) and the one over it (copy,
  // callouts…). Both get the same opacity/offset.
  const underRefs = useRef([])
  const overRefs = useRef([])
  const [size, setSize] = useState(null) // { w, h } of the stage
  const [imgOk, setImgOk] = useState(true)

  // Measure the stage (rare: mount + resize).
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll -> scene position -> transforms.
  useEffect(() => {
    const root = rootRef.current
    if (!root || !size || !scenes.length) return
    const scroller = root.closest('.item')
    if (!scroller) return
    const { w, h } = size
    const ow = w * baseW
    const oh = ow / aspect
    const last = scenes.length - 1
    const objs = scenes.map(sceneObject)
    let raf = 0

    const apply = () => {
      raf = 0
      const scrolled = scroller.getBoundingClientRect().top - root.getBoundingClientRect().top
      const pos = clamp(scrolled / h, 0, last)
      const i = Math.floor(pos)
      const e = settle(pos - i)
      const a = objs[i]
      const b = objs[Math.min(i + 1, last)]
      const x = lerp(a.x, b.x, e) * w - ow / 2
      const y = lerp(a.y, b.y, e) * h - oh / 2
      const s = lerp(a.scale, b.scale, e)
      const r = lerp(a.rotate, b.rotate, e)
      if (objRef.current) objRef.current.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`

      scenes.forEach((sc, k) => {
        const d = pos - k
        const g = glowRefs.current[k]
        if (g) g.style.opacity = String(num(sc.glow?.opacity, 0.3) * clamp(1 - Math.abs(d)))
        const vis = clamp(1 - Math.abs(d) * COPY_FADE)
        for (const l of [underRefs.current[k], overRefs.current[k]]) {
          if (!l) continue
          l.style.opacity = String(vis)
          l.style.transform = `translateY(${-d * COPY_TRAVEL * h}px)`
          l.style.visibility = vis > 0 ? 'visible' : 'hidden'
        }
      })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }
    apply()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [size, scenes.length, baseW, aspect])

  if (!scenes.length) return null
  const ow = size ? size.w * baseW : 0
  const oh = ow / aspect

  return (
    <section className="s-scrolly" ref={rootRef} style={{ height: `${scenes.length * 100}vh` }}>
      {/* Gentle snap to each scene, so a flick lands on a composed frame. */}
      {scenes.map((_, k) => (
        <div key={k} className="sc-snap" style={{ top: `${k * 100}vh` }} aria-hidden="true" />
      ))}
      <div className="sc-stage" ref={stageRef}>
        {size &&
          scenes.map((sc, k) => {
            const g = sc.glow || {}
            const gs = num(g.size, 0.8) * size.w
            return (
              <div
                key={k}
                className="sc-glow"
                ref={(el) => (glowRefs.current[k] = el)}
                style={{
                  width: gs,
                  height: gs,
                  left: num(g.x, 0.5) * size.w - gs / 2,
                  top: num(g.y, 0.6) * size.h - gs / 2,
                  '--glow': typeof g.color === 'string' ? g.color : '#FFB347',
                  opacity: 0,
                }}
              />
            )
          })}

        {size &&
          scenes.map((sc, k) => (
            <div key={k} className="sc-layer" ref={(el) => (underRefs.current[k] = el)}>
              <Extras scene={sc} size={size} ow={ow} oh={oh} src={imgOk ? src : null} layer="under" />
            </div>
          ))}

        {size && src && imgOk && (
          <img
            ref={objRef}
            className="sc-object"
            src={src}
            alt=""
            draggable={false}
            style={{ width: ow, height: oh }}
            onError={() => setImgOk(false)}
          />
        )}

        {size &&
          scenes.map((sc, k) => (
            <div key={k} className="sc-layer" ref={(el) => (overRefs.current[k] = el)}>
              <Extras scene={sc} size={size} ow={ow} oh={oh} src={imgOk ? src : null} layer="over" />
              <SceneCopy sc={sc} size={size} />
            </div>
          ))}
      </div>
    </section>
  )
}

function SceneCopy({ sc, size }) {
  return (
    <div className={`sc-copy${sc.align === 'center' ? ' is-center' : ''}`} style={{ top: num(sc.copyY, 0.1) * size.h }}>
      {sc.kicker && <div className="sc-kicker">{sc.kicker}</div>}
      {sc.headline && <h2 className="sc-headline">{sc.headline}</h2>}
      {sc.body && <p className="sc-body">{sc.body}</p>}
    </div>
  )
}

// Where the object sits (unrotated box) when a scene is at rest.
function objectBox(sc, size, ow, oh) {
  const o = sceneObject(sc)
  const w = ow * o.scale
  const h = oh * o.scale
  return { left: o.x * size.w - w / 2, top: o.y * size.h - h / 2, w, h }
}

function Extras({ scene, size, ow, oh, src, layer }) {
  const extras = Array.isArray(scene.extras) ? scene.extras : []
  const box = objectBox(scene, size, ow, oh)
  return extras.map((ex, i) => {
    const Comp = EXTRAS[ex?.type]
    if (!Comp) return null // unknown extra types are skipped, like sections
    return <Comp key={i} ex={ex} size={size} box={box} ow={ow} oh={oh} src={src} layer={layer} />
  })
}

const EXTRAS = {
  // "Swipe up" cue at the bottom.
  hint: ({ ex, layer }) =>
    layer === 'over' && (
      <div className="sc-hint">
        <svg viewBox="0 0 36 20" aria-hidden="true">
          <path d="M4 16 L18 4 L32 16" />
        </svg>
        {ex.label || 'Swipe up'}
      </div>
    ),

  // Labels on the left with lines to points on the object.
  // items: [{ label, y }] with y as a fraction of object height; anchorX likewise.
  callouts: ({ ex, size, box, layer }) => {
    if (layer !== 'over' || !Array.isArray(ex.items)) return null
    const lineStart = size.w * 0.35
    const ax = box.left + num(ex.anchorX, 0.125) * box.w
    return ex.items.map((it, i) => {
      const y = box.top + num(it.y, 0.5) * box.h
      return (
        <div key={i}>
          <div className="sc-callout-label" style={{ top: y, width: lineStart - 12 - 28 }}>
            {it.label}
          </div>
          <div className="sc-callout-line" style={{ left: lineStart, top: y, width: Math.max(0, ax - lineStart) }} />
          <div className="sc-callout-dot" style={{ left: ax - 3, top: y - 3 }} />
        </div>
      )
    })
  },

  // Rounded outline around part of the object (fractions of the object box).
  highlight: ({ ex, box, layer }) => {
    if (layer !== 'over') return null
    const w = num(ex.w, 0.9) * box.w
    const h = num(ex.h, 0.15) * box.h
    return (
      <div
        className="sc-highlight"
        style={{ left: box.left + num(ex.x, 0.5) * box.w - w / 2, top: box.top + num(ex.y, 0.5) * box.h - h / 2, width: w, height: h }}
      />
    )
  },

  // Concentric rings around a point on the object. radii: fractions of object width.
  rings: ({ ex, box, layer }) => {
    if (layer !== 'over') return null
    const cx = box.left + num(ex.x, 0.5) * box.w
    const cy = box.top + num(ex.y, 0.5) * box.h
    const radii = Array.isArray(ex.radii) ? ex.radii : [0.37, 0.56, 0.77]
    return radii.map((r, i) => {
      const d = r * 2 * box.w
      return <div key={i} className="sc-ring" style={{ left: cx - d / 2, top: cy - d / 2, width: d, height: d, opacity: 1 - i * 0.35 }} />
    })
  },

  // Vertical level meter. value 0–1.
  meter: ({ ex, size, layer }) => {
    if (layer !== 'over') return null
    const v = clamp(num(ex.value, 0.7))
    const left = num(ex.x, 0.14) * size.w
    const top = num(ex.top, 0.4375) * size.h
    const h = num(ex.height, 0.344) * size.h
    const knobY = top + h * (1 - v)
    return (
      <>
        <div className="sc-meter-track" style={{ left, top, height: h }} />
        <div className="sc-meter-fill" style={{ left, top: knobY, height: h * v }} />
        <div className="sc-meter-knob" style={{ left: left - 8, top: knobY - 8 }} />
        <div className="sc-meter-value" style={{ left: left + 24, top: knobY - 22 }}>
          {Math.round(v * 100)}%
          {ex.label && <span>{ex.label}</span>}
        </div>
      </>
    )
  },

  // Round badge, e.g. a coin cell. size: fraction of stage width.
  badge: ({ ex, size, layer }) => {
    if (layer !== 'over') return null
    const d = num(ex.size, 0.3) * size.w
    return (
      <div className="sc-badge" style={{ left: num(ex.x, 0.7) * size.w - d / 2, top: num(ex.y, 0.65) * size.h - d / 2, width: d, height: d }}>
        <strong>{ex.title}</strong>
        {ex.subtitle && <span>{ex.subtitle}</span>}
      </div>
    )
  },

  // Row of ways to use the object: bases (wall plate / pedestal), optional
  // extra copies of the object, and labels. The scene's own object is usually
  // the first item. items: [{ x, label, sub, base: "plate"|"pedestal", clone, rotate }]
  mounts: ({ ex, size, box, src, layer }) => {
    if (!Array.isArray(ex.items)) return null
    const cy = box.top + box.h / 2
    return ex.items.map((it, i) => {
      const cx = num(it.x, 0.5) * size.w
      if (layer === 'under') {
        if (it.base === 'plate') {
          const w = box.w * 1.67
          const h = box.h * 1.29
          return <div key={i} className="sc-base" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, borderRadius: 11 }} />
        }
        if (it.base === 'pedestal') {
          const w = box.w * 1.44
          return <div key={i} className="sc-base" style={{ left: cx - w / 2, top: cy + box.h * 0.34, width: w, height: box.h * 0.27, borderRadius: 12 }} />
        }
        return null
      }
      return (
        <div key={i}>
          {it.clone && src && (
            <img
              className="sc-clone"
              src={src}
              alt=""
              draggable={false}
              style={{ left: cx - box.w / 2, top: cy - box.h / 2 - (it.base === 'pedestal' ? box.h * 0.13 : 0), width: box.w, height: box.h, transform: `rotate(${num(it.rotate, 0)}deg)` }}
            />
          )}
          <div className="sc-mount-label" style={{ left: cx - size.w * 0.15, top: num(ex.labelY, 0.771) * size.h, width: size.w * 0.3 }}>
            <strong>{it.label}</strong>
            {it.sub && <span>{it.sub}</span>}
          </div>
        </div>
      )
    })
  },
}
