// { "type": "specs", "heading"?: "…", "rows": [["Label", "Value"], …] }
export default function Specs({ section }) {
  const rows = Array.isArray(section.rows)
    ? section.rows.filter((r) => Array.isArray(r) && r.length >= 2)
    : []
  if (!rows.length) return null
  return (
    <section className="s-specs">
      <h2 className="s-heading">{section.heading || 'Specifications'}</h2>
      <dl>
        {rows.map(([k, v], i) => (
          <div className="s-specs-row" key={i}>
            <dt>{String(k)}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
