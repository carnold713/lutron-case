import MediaImage from './MediaImage.jsx'
import TitleBlock from './TitleBlock.jsx'

// { "type": "hero", "image": "media/…", "caption": "…" }
// As the first section it carries the item title over the image. A missing
// image falls back to an accent-tinted field, so the page still leads well.
export default function Hero({ section, item, isFirst }) {
  return (
    <section className="s-hero">
      <div className="s-hero-media">
        <MediaImage src={section.image} className="s-hero-img" eager fallback={<div className="s-hero-fallback" />} />
        {isFirst && <TitleBlock item={item} overlay />}
      </div>
      {typeof section.caption === 'string' && section.caption && (
        <p className="s-hero-caption">{section.caption}</p>
      )}
    </section>
  )
}
