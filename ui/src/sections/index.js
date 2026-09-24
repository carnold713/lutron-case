import Hero from './Hero.jsx'
import Text from './Text.jsx'
import Specs from './Specs.jsx'
import Gallery from './Gallery.jsx'
import Video from './Video.jsx'
import Quote from './Quote.jsx'
import Scrolly from './Scrolly.jsx'

// Section type (the "type" field in items.json) -> component.
// Each component receives { section, item, isFirst }.
// To add a kind of content: write one component, add one line here.
// Types not listed here are skipped silently by the item view.
export const SECTIONS = {
  hero: Hero,
  text: Text,
  specs: Specs,
  gallery: Gallery,
  video: Video,
  quote: Quote,
  scrolly: Scrolly,
}
