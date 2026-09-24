import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// content/ lives outside the app bundle so a product is a data edit, not a
// rebuild. On the Pi, deploy.sh copies it to ~/kiosk/ui/content/. In dev we
// serve ../content at the same /content/ URL so the app code is identical.
const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url))

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

export default defineConfig({
  plugins: [react(), serveContent()],
  // Relative asset paths: the build works from any directory the Pi serves.
  base: './',
  build: {
    target: 'es2022',
    // Inline nothing from the network; everything is bundled locally anyway.
    assetsInlineLimit: 4096,
  },
})
