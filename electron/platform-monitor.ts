import { clipboard, nativeImage } from 'electron'

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
  const fileFormats = formats.filter(f =>
    f.includes('FileName') || f.includes('public.file-url') || f === 'NSFilenamesPboardType',
  )
  if (fileFormats.length === 0) return []
  const paths: string[] = []
  for (const fmt of fileFormats) {
    try {
      const buf = clipboard.readBuffer(fmt)
      if (!buf) continue
      const str = buf.toString('utf8')
      if (fmt === 'public.file-url') {
        const urls = str.split('\n').filter(Boolean)
        for (const url of urls) {
          try { paths.push(decodeURIComponent(url.replace(/^file:\/\//, ''))) } catch {}
        }
      } else if (fmt.startsWith('FileName')) {
        paths.push(str.replace(/\0/g, ''))
      }
    } catch {}
  }
  return [...new Set(paths)]
}

function poll(): void {
  const currentText = clipboard.readText()
  const currentHtml = clipboard.readHTML()
  const currentImage = clipboard.readImage()
  const currentFiles = readFileListFromClipboard()

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

  // 2. image
  const currentImagePng = currentImage.isEmpty() ? null : currentImage.toPNG()
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
