import MediaImage from './MediaImage.jsx'

// { "type": "gallery", "heading"?: "…", "images": ["media/…", …] }
// A horizontal swipe strip. Missing images simply drop out.
export default function Gallery({ section }) {
  const images = Array.isArray(section.images) ? section.images.filter((s) => typeof s === 'string') : []
  if (!images.length) return null
  return (
    <section className="s-gallery">
      {section.heading && <h2 className="s-heading">{section.heading}</h2>}
      <div className="s-gallery-strip">
        {images.map((src, i) => (
          <MediaImage key={i} src={src} className="s-gallery-img" />
        ))}
      </div>
    </section>
  )
}
