const { writeFileSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const resourcesDir = join(__dirname, '..', 'resources')
if (!existsSync(resourcesDir)) mkdirSync(resourcesDir, { recursive: true })

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

function createIco(pngData) {
  const buf = Buffer.alloc(22 + pngData.length)
  buf.writeUInt16LE(0, 0)    // reserved
  buf.writeUInt16LE(1, 2)    // ICO type
  buf.writeUInt16LE(1, 4)    // count
  buf.writeUInt8(0, 6)       // width (0=256)
  buf.writeUInt8(0, 7)       // height (0=256)
  buf.writeUInt8(0, 8)       // color count
  buf.writeUInt8(0, 9)       // reserved
  buf.writeUInt16LE(1, 10)   // planes
  buf.writeUInt16LE(32, 12)  // bpp
  buf.writeUInt32LE(pngData.length, 14) // image size
  buf.writeUInt32LE(22, 18)  // offset
  pngData.copy(buf, 22)      // PNG data
  return buf
}

const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22">
  <path fill="black" fill-rule="evenodd" d="M3 3 H15 V19 H3 Z M4.5 4.5 V17.5 H13.5 V4.5 Z M7 1.5 H11 V4 H7 Z"/>
  <rect x="5.5" y="7" width="7" height="1" fill="black"/>
  <rect x="5.5" y="9.5" width="7" height="1" fill="black"/>
  <rect x="5.5" y="12" width="4.5" height="1" fill="black"/>
  <path fill="black" d="M14.5 13 L20 18.5 L17.5 21 L12 15.5 Z"/>
  <circle cx="17.6" cy="19.5" r="1.6" fill="black"/>
</svg>`

async function main() {
  try {
    const sharp = require('sharp')
    const png512 = await sharp(Buffer.from(svgIcon)).resize(512, 512).png().toBuffer()
    writeFileSync(join(resourcesDir, 'icon.png'), png512)
    const ico = createIco(png512)
    writeFileSync(join(resourcesDir, 'icon.ico'), ico)

    // macOS template icon: alpha-only PNG at 22pt + 44pt for Retina
    writeFileSync(join(resourcesDir, 'trayIconTemplate.svg'), traySvg)
    const tray22 = await sharp(Buffer.from(traySvg)).resize(22, 22).png().toBuffer()
    writeFileSync(join(resourcesDir, 'trayIconTemplate.png'), tray22)
    const tray44 = await sharp(Buffer.from(traySvg)).resize(44, 44).png().toBuffer()
    writeFileSync(join(resourcesDir, 'trayIconTemplate@2x.png'), tray44)

    console.log('Icons generated successfully')
  } catch (e) {
    console.log('sharp not available, SVG icons created at resources/')
  }
}

main()
