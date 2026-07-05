// electron-builder `afterPack` hook.
//
// electron-builder copies Electron's framework verbatim into the .app bundle.
// That framework carries a lot of weight we don't need for a clipboard
// manager: SwiftShader (a CPU-only Vulkan fallback for headless environments),
// Chromium's bundled ffmpeg (for HTML5 video we never play), and Chromium's
// UI strings localised into ~50 languages. This hook trims those three
// categories down to the essentials and reports what it removed so the size
// delta is visible in the build log.
//
// Triggered by `afterPack: scripts/after-pack.js` in electron-builder.yml.
// electron-builder invokes this with (context) where context.packager is a
// PlatformPackager exposing .appOutDir (the platform-specific .app path).

const fs = require('fs')
const path = require('path')

// Locales worth keeping. `en` covers English (and acts as the fallback when a
// string is missing in a more specific variant), `zh_CN` covers Simplified
// Chinese which is the app's primary audience. Everything else is
// Chromium UI localisation that the user never sees in this app.
const KEEP_LOCALES = new Set(['en', 'zh_CN'])

// Components that are safe to delete from Electron Framework. The keep-side
// is just for sanity in case Chromium starts depending on one of these.
const REMOVABLE_FILES = [
  // Software Vulkan implementation. Macs always have a GPU; this is only
  // useful for headless / VM scenarios.
  'Libraries/libvk_swiftshader.dylib',
  'Libraries/vk_swiftshader_icd.json',
  // Chromium's built-in ffmpeg is used for HTML5 video / audio. A clipboard
  // manager doesn't play media, so the proprietary codecs (H.264 / AAC) ship
  // here can go. The system provides ffmpeg via AVFoundation if ever needed.
  'Libraries/libffmpeg.dylib',
]

function rmIfExists(target) {
  if (!fs.existsSync(target)) return 0
  const size = fs.statSync(target).isDirectory()
    ? dirSize(target)
    : fs.statSync(target).size
  fs.rmSync(target, { recursive: true, force: true })
  return size
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

module.exports = async function afterPack(context) {
  // Only macOS bundles need this trimming; the Windows installer and Linux
  // AppImage build paths don't expose Electron's internals the same way.
  if (process.platform !== 'darwin') return

  const appOutDir = context?.packager?.appOutDir
  if (!appOutDir || !fs.existsSync(appOutDir)) {
    console.warn('[after-pack] appOutDir missing, skipping trim')
    return
  }

  const fwDir = path.join(
    appOutDir,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A'
  )
  if (!fs.existsSync(fwDir)) {
    console.warn('[after-pack] Electron Framework not found, skipping trim')
    return
  }

  let freed = 0

  // 1. Targeted framework files (SwiftShader, ffmpeg).
  for (const rel of REMOVABLE_FILES) {
    const target = path.join(fwDir, rel)
    const size = rmIfExists(target)
    if (size > 0) {
      console.log(`[after-pack] removed ${rel} (${formatBytes(size)})`)
      freed += size
    }
  }

  // 2. Localised Chromium UI strings. The Resources folder holds one .lproj
  // per locale, each containing a few hundred KB of Chromium UI .strings
  // files. Keeping only en + zh_CN still gives users a localised fallback
  // (en) and the app's primary audience language.
  const resourcesDir = path.join(fwDir, 'Resources')
  if (fs.existsSync(resourcesDir)) {
    const removed = []
    let localeBytes = 0
    for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('.lproj')) continue
      const locale = entry.name.slice(0, -'.lproj'.length)
      // Some locales also ship gendered / script variants like
      // `af_FEMININE.lproj` or `zh_Hant_HK.lproj` — strip those too once we
      // drop the base locale. The base form itself is matched first so it
      // gets dropped first; the variants go in the same pass.
      const base = locale.split(/[_@]/)[0]
      if (KEEP_LOCALES.has(locale) || KEEP_LOCALES.has(base)) continue
      const target = path.join(resourcesDir, entry.name)
      const size = rmIfExists(target)
      removed.push(entry.name)
      localeBytes += size
      freed += size
    }
    if (removed.length) {
      console.log(
        `[after-pack] pruned ${removed.length} locales ` +
          `(${formatBytes(localeBytes)}): ` +
          `${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ', ...' : ''}`
      )
    }
  }

  console.log(`[after-pack] total trimmed: ${formatBytes(freed)}`)
}