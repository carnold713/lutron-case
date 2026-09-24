import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../content.js'

// { "type": "video", "src": "media/…mp4", "poster": "media/…jpg", "caption"?: "…" }
// Battery: never autoplays, preloads nothing, and pauses once scrolled out of
// view. Tap the poster to play. If the file can't play, the section hides.
export default function Video({ section }) {
  const src = mediaUrl(section.src)
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !playing) return
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) el.pause()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [playing])

  if (!src || failed) return null

  const start = () => {
    setPlaying(true)
    ref.current?.play().catch(() => setFailed(true))
  }

  return (
    <section className="s-video">
      <div className="s-video-frame">
        <video
          ref={ref}
          src={src}
          poster={mediaUrl(section.poster) || undefined}
          preload="none"
          playsInline
          controls={playing}
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          onError={() => setFailed(true)}
          onEnded={() => setPlaying(false)}
        />
        {!playing && (
          <button className="s-video-play" onClick={start} aria-label="Play video">
            <span className="s-video-play-icon" aria-hidden="true" />
          </button>
        )}
      </div>
      {section.caption && <p className="s-video-caption">{section.caption}</p>}
    </section>
  )
}
