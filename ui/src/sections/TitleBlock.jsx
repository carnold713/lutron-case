export default function TitleBlock({ item, overlay = false }) {
  return (
    <header className={`title-block${overlay ? ' is-overlay' : ''}`}>
      {item.subtitle && <div className="title-sub">{item.subtitle}</div>}
      <h1 className="title">{item.title}</h1>
    </header>
  )
}
