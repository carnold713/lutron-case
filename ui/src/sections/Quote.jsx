// { "type": "quote", "body": "…", "attribution": "…" }
export default function Quote({ section }) {
  if (typeof section.body !== 'string' || !section.body) return null
  return (
    <section className="s-quote">
      <blockquote>{section.body}</blockquote>
      {section.attribution && <div className="s-quote-by">— {section.attribution}</div>}
    </section>
  )
}
