import { clipboard } from 'electron'
import fs from 'fs'

export interface ClipboardEvent {
  content: string
  contentHtml?: string
  dataType: 'text' | 'richtext' | 'image' | 'files'
  imageData?: Uint8Array
  filePaths?: string[]
  sourceApp: string
  sensitive?: boolean
}

let onEvent: ((event: ClipboardEvent) => void) | null = null
let pollingTimer: ReturnType<typeof setInterval> | null = null
let pollingInterval = 500

let lastText = ''
let lastHtml = ''
let lastImageBuf: Buffer | null = null
let lastFiles: string[] = []

const DEDUP_WINDOW = 100
let lastEventTime = 0

let exclusionApps: string[] = []
let exclusionPatterns: RegExp[] = []
let ctrlDown = false

export function setExclusionApps(apps: string[]): void {
  exclusionApps = apps
}

export function setExclusionPatterns(patterns: string[]): void {
  exclusionPatterns = patterns.map((p) => new RegExp(p, 'i'))
}

export function setCtrlState(down: boolean): void {
  ctrlDown = down
}

function isExcluded(app: string, content: string): boolean {
  if (exclusionApps.includes(app)) return true
  for (const pattern of exclusionPatterns) {
    if (pattern.test(content)) return true
  }
  return false
}

function isDuplicate(): boolean {
  const now = Date.now()
  if (now - lastEventTime < DEDUP_WINDOW) return true
  lastEventTime = now
  return false
}

function readFileListFromClipboard(): string[] {
  const formats = clipboard.availableFormats()
  // Match every known file-reference format across platforms:
  //   macOS:   public.file-url, NSFilenamesPboardType, dyn.* UTIs
  //   Windows: FileName, FileNameW (CF_FILENAME / CF_FILENAMEW)
  //   Linux:   text/uri-list
  // We lowercase before matching so platform casing differences (e.g.
  // NSFilenamesPboardType vs. nsfilenamespboardtype) don't slip through.
  const fileFormats = formats.filter((f) => {
    const fl = f.toLowerCase()
    return fl.includes('filename')
      || fl.includes('file-url')
      || fl === 'nsfilenamespboardtype'
      || fl === 'text/uri-list'
  })
  if (fileFormats.length === 0) return []
  const paths: string[] = []
  for (const fmt of fileFormats) {
    try {
      const buf = clipboard.readBuffer(fmt)
      if (!buf) continue
      const str = buf.toString('utf8').replace(/\0/g, '')
      if (str.trim().length === 0) continue
      const fl = fmt.toLowerCase()
      if (fl === 'text/uri-list' || fl.includes('file-url') || fl === 'nsfilenamespboardtype') {
        // URI list (one URL per line, possibly file:// scheme).
        const urls = str.split(/[\r\n]+/).filter(Boolean)
        for (const url of urls) {
          try {
            let p = url.trim()
            if (p.toLowerCase().startsWith('file://')) {
              p = decodeURIComponent(p.replace(/^file:\/\//i, ''))
            }
            if (p) paths.push(p)
            // eslint-disable-next-line no-empty
          } catch {}
        }
      } else if (fl.includes('filename')) {
        // Windows CF_FILENAME / CF_FILENAMEW only carries the bare filename,
        // not a full path — promote to a path only when it actually looks
        // like one (otherwise we'd inject garbage like "Document.docx").
        if (/[\\/]/.test(str) || /^[A-Za-z]:/.test(str)) {
          paths.push(str)
        }
      }
      // eslint-disable-next-line no-empty
    } catch {}
  }
  return [...new Set(paths)]
}

// Heuristic: a single text line that starts with a path-like prefix and
// resolves on disk is almost always a file copy that didn't expose any
// standard file-reference format (e.g. pbcopy, some CLI tools, terminal
// drag-and-drop on Linux). Without this fallback those copies get buried
// under image / text.
function looksLikeExistingFilePath(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/\s/.test(trimmed)) return null
  if (trimmed.length > 4096) return null
  const isPathLike = trimmed.startsWith('/')
    || trimmed.startsWith('~/')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
  if (!isPathLike) return null
  try {
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) return trimmed
    // eslint-disable-next-line no-empty
  } catch {}
  return null
}

function poll(): void {
  const currentText = clipboard.readText()
  const currentHtml = clipboard.readHTML()
  const currentImage = clipboard.readImage()
  const currentFiles = readFileListFromClipboard()
  // Decode the PNG once up front so both the text→file fallback (1b) and the
  // image branch (2) can inspect it without re-reading from the OS clipboard.
  const currentImagePng = currentImage.isEmpty() ? null : currentImage.toPNG()

  if (isDuplicate()) return

  // 1. files 最具体，优先判断
  if (currentFiles.length > 0) {
    const filesStr = JSON.stringify(currentFiles)
    const lastFilesStr = JSON.stringify(lastFiles)
    if (filesStr !== lastFilesStr) {
      lastFiles = currentFiles
      const content = currentFiles.join('\n')
      if (!isExcluded('', content)) {
        onEvent?.({
          content,
          dataType: 'files',
          filePaths: currentFiles,
          sourceApp: '',
          sensitive: ctrlDown,
        })
      }
    }
    return
  }

  // 1b. text fallback: a bare text payload that resolves to an existing file
  //     path is still a file copy. Catch it before we drop into image / text.
  if (!currentImagePng && currentText && currentText !== lastText) {
    const filePath = looksLikeExistingFilePath(currentText)
    if (filePath) {
      lastText = currentText
      lastFiles = [filePath]
      if (!isExcluded('', filePath)) {
        onEvent?.({
          content: filePath,
          dataType: 'files',
          filePaths: [filePath],
          sourceApp: '',
          sensitive: ctrlDown,
        })
      }
      return
    }
  }

  // 2. image
  if (currentImagePng && (!lastImageBuf || !currentImagePng.equals(lastImageBuf))) {
    lastImageBuf = currentImagePng
    onEvent?.({
      content: '',
      dataType: 'image',
      imageData: new Uint8Array(currentImagePng),
      sourceApp: '',
      sensitive: ctrlDown,
    })
    return
  }

  // 3. text / richtext 最不具体，放最后
  if (currentText && currentText !== lastText) {
    lastText = currentText
    const html = currentHtml !== lastHtml ? currentHtml : undefined
    if (html) lastHtml = currentHtml

    if (!isExcluded('', currentText)) {
      onEvent?.({
        content: currentText,
        contentHtml: html,
        dataType: html ? 'richtext' : 'text',
        sourceApp: '',
        sensitive: ctrlDown,
      })
    }
  }
}

export function startMonitoring(
  callback: (event: ClipboardEvent) => void,
  interval = 500,
): void {
  onEvent = callback
  pollingInterval = interval

  lastText = clipboard.readText()
  lastHtml = clipboard.readHTML()
  const img = clipboard.readImage()
  lastImageBuf = img.isEmpty() ? null : img.toPNG()
  lastFiles = readFileListFromClipboard()

  pollingTimer = setInterval(poll, pollingInterval)
}

export function stopMonitoring(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
  onEvent = null
}

export function setPollingInterval(ms: number): void {
  pollingInterval = ms
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = setInterval(poll, pollingInterval)
  }
}
