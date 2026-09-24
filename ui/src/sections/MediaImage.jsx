import { useState } from 'react'
import { mediaUrl } from '../content.js'

// An image from content/media that never shows a broken-image icon: if the
// path is bad or the file is missing, it renders `fallback` (default nothing).
export default function MediaImage({ src, alt = '', className, fallback = null, eager = false }) {
  const url = mediaUrl(src)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return fallback
  return (
    <img
      className={className}
      src={url}
      alt={alt}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
