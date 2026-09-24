import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// content/ lives outside the app bundle so a product is a data edit, not a
// rebuild. On the Pi, update.sh copies it to ~/kiosk/ui/content/. In dev we
// serve ../content at the same /content/ URL so the app code is identical.
const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url))

// Dev stand-in for kiosk_server.py's /api/tags: tag assignments made in the
// browser during development land here (gitignored), not in content/.
const DEV_TAGS = fileURLToPath(new URL('../.dev-data/tags.json', import.meta.url))
const UID_RE = /^[0-9a-f]{4,32}$/
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const MIME = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function serveContent() {
  return {
    name: 'serve-content',
    configureServer(server) {
      server.middlewares.use('/content', (req, res, next) => {
        const rel = normalize(decodeURIComponent(req.url.split('?')[0]))
        const file = join(CONTENT_DIR, rel)
        if (!file.startsWith(CONTENT_DIR)) return next()
        let stat
        try {
          stat = statSync(file)
        } catch {
          res.statusCode = 404
          return res.end()
        }
        if (!stat.isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
        res.setHeader('Content-Length', stat.size)
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(file).pipe(res)
      })
    },
  }
}

function tagApi() {
  const load = () => {
    try {
      return JSON.parse(readFileSync(DEV_TAGS, 'utf8'))
    } catch {
      return {}
    }
  }
  const send = (res, code, obj) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  return {
    name: 'tag-api',
    configureServer(server) {
      server.middlewares.use('/api/tags', (req, res) => {
        if (req.method === 'GET') return send(res, 200, load())
        if (req.method !== 'POST') return send(res, 405, { error: 'method' })
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          let msg
          try {
            msg = JSON.parse(body || '{}')
          } catch {
            return send(res, 400, { error: 'bad json' })
          }
          const uid = String(msg.uid || '').toLowerCase()
          const target = msg.target ?? null
          if (!UID_RE.test(uid)) return send(res, 400, { error: 'bad uid' })
          if (target !== null && !(typeof target === 'string' && TARGET_RE.test(target)))
            return send(res, 400, { error: 'bad target' })
          const tags = load()
          tags[uid] = target
          mkdirSync(fileURLToPath(new URL('../.dev-data/', import.meta.url)), { recursive: true })
          writeFileSync(DEV_TAGS, JSON.stringify(tags, null, 2) + '\n')
          send(res, 200, { uid, target })
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveContent(), tagApi()],
  // Relative asset paths: the build works from any directory the Pi serves.
  base: './',
  build: {
    target: 'es2022',
    // Inline nothing from the network; everything is bundled locally anyway.
    assetsInlineLimit: 4096,
  },
})
