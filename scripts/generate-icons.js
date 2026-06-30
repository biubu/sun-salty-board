const { writeFileSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const resourcesDir = join(__dirname, '..', 'resources')
if (!existsSync(resourcesDir)) mkdirSync(resourcesDir, { recursive: true })

function svgToPng(svg: string, size: number): Buffer {
  const sharp = (() => {
    try { return require('sharp') } catch { return null }
  })()
  if (sharp) {
    return sharp(Buffer.from(svg)).resize(size, size).png().toBufferSync()
  }
  return Buffer.from(svg)
}

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#1a1a2e"/>
  <rect x="120" y="80" width="272" height="352" rx="24" fill="none" stroke="#4fc3f7" stroke-width="32"/>
  <rect x="176" y="136" width="160" height="40" rx="8" fill="#4fc3f7" opacity="0.6"/>
  <rect x="176" y="200" width="160" height="40" rx="8" fill="#4fc3f7" opacity="0.4"/>
  <rect x="176" y="264" width="100" height="40" rx="8" fill="#4fc3f7" opacity="0.3"/>
  <path d="M360 280 L440 360 L400 400 L320 320 Z" fill="#ffd54f" opacity="0.8"/>
  <circle cx="420" cy="380" r="40" fill="#ffd54f"/>
  <text x="420" y="392" text-anchor="middle" font-size="32" font-weight="bold" fill="#1a1a2e">C</text>
</svg>`

writeFileSync(join(resourcesDir, 'icon.svg'), svgIcon)

try {
  const sharp = require('sharp')
  const buf = sharp(Buffer.from(svgIcon)).resize(256, 256).png().toBufferSync()
  writeFileSync(join(resourcesDir, 'icon.png'), buf)
  writeFileSync(join(resourcesDir, 'icon.ico'), buf)
  console.log('Icons generated successfully')
} catch {
  console.log('sharp not available, SVG icon created at resources/icon.svg')
  writeFileSync(join(resourcesDir, 'icon.png'), Buffer.alloc(0))
  writeFileSync(join(resourcesDir, 'icon.ico'), Buffer.alloc(0))
}
