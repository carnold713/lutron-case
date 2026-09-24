// A tag we have no content for. Deliberately calm — and it shows the UID, so
// this screen is also how new objects get registered: put a fresh sticker on
// the pad, copy the UID into content/items.json.
export default function Unknown({ uid, at, contentMissing }) {
  return (
    <main className="view unknown">
      <div className="unknown-inner">
        <div className="unknown-mark" aria-hidden="true" />
        <h1 className="unknown-title">We don’t recognise this one yet</h1>
        <p className="unknown-sub">
          {contentMissing ? 'The product library isn’t available right now.' : 'Try another product on the pad.'}
        </p>
        <div className="uid">
          <div className="uid-label">Tag ID</div>
          <div className="uid-value">{groupHex(uid)}</div>
          {at && <div className="uid-at">read at {at}</div>}
        </div>
      </div>
    </main>
  )
}

// "04a1b2c3d4e5f6" -> "04a1 b2c3 d4e5 f6" — easier to read off and type in.
const groupHex = (s) => String(s).match(/.{1,4}/g)?.join(' ') ?? String(s)
