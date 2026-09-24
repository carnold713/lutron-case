// { "type": "text", "heading": "…", "body": "…" }
// Blank lines in body split paragraphs.
export default function Text({ section }) {
  const paras = typeof section.body === 'string' ? section.body.split(/\n\s*\n/).filter(Boolean) : []
  if (!section.heading && !paras.length) return null
  return (
    <section className="s-text">
      {section.heading && <h2 className="s-heading">{section.heading}</h2>}
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </section>
  )
}
