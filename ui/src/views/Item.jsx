import { memo, useRef } from 'react'
import { normaliseItem } from '../content.js'
import { SECTIONS } from '../sections/index.js'
import TitleBlock from '../sections/TitleBlock.jsx'
import ErrorBoundary from '../ErrorBoundary.jsx'

// Touches/scrolls restart the hold countdown, but not on every scroll event.
const INTERACT_THROTTLE_MS = 2000

// Memoised: App re-renders on every light reading, the item doesn't need to.
export default memo(function Item({ raw, holding, holdEpoch, holdMs, onInteract }) {
  const item = normaliseItem(raw)
  const lastInteract = useRef(0)

  const interact = () => {
    if (!onInteract) return
    const now = Date.now()
    if (now - lastInteract.current < INTERACT_THROTTLE_MS) return
    lastInteract.current = now
    onInteract()
  }

  // The first section gets the title if it's a hero; otherwise the title
  // block leads the page on its own.
  const leadsWithHero = item.sections[0]?.type === 'hero'

  return (
    <main
      className="view item"
      style={item.accent ? { '--accent': item.accent } : undefined}
      onPointerDown={interact}
      onScroll={interact}
    >
      {!leadsWithHero && <TitleBlock item={item} />}
      {item.sections.map((section, i) => {
        const Section = SECTIONS[section.type]
        // Unknown section types are skipped silently.
        if (!Section) return null
        return (
          <ErrorBoundary key={i}>
            <Section section={section} item={item} isFirst={i === 0} />
          </ErrorBoundary>
        )
      })}
      <div className="item-end" aria-hidden="true" />

      {holding && (
        // Quiet cue that the product was lifted and this will close by itself.
        // One CSS animation per countdown; restarts when holdEpoch changes.
        <div className="hold-bar" aria-hidden="true">
          <div key={holdEpoch} className="hold-bar-fill" style={{ animationDuration: `${holdMs}ms` }} />
        </div>
      )}
    </main>
  )
})
