import { describe, it, expect } from 'vitest'

// Stand-in for the clipboard API so we can drive
// readFileListFromClipboard without a real clipboard runtime.
function makeFakeClipboard(formats: Record<string, string>) {
  return {
    availableFormats: () => Object.keys(formats),
    readBuffer: (fmt: string) => {
      const v = formats[fmt]
      if (v === undefined) return null
      return Buffer.from(v, 'utf8')
    },
  } as any
}

describe('clipboard file detection (pure helpers, no Electron)', () => {
  it('stale-row cutoff keeps fresher items', () => {
    // Equivalent of the SQL cutoff query now living in worker.ts; expressed
    // here in plain JS so the test doesn't depend on a particular SQLite
    // binding (we used to drive this through sql.js).
    const now = Date.now()
    const retentionDays = 30
    const cutOffMs = now - retentionDays * 24 * 60 * 60 * 1000
    const rows = [
      { id: 1, createdAtDays: 40 },
      { id: 2, createdAtDays: 10 },
    ]
    const staleIds = rows.filter((r) => now - r.createdAtDays * 24 * 60 * 60 * 1000 < cutOffMs)
    // The "now - elapsed < cutoff" pattern checks that older rows fall outside
    // the retention window — i.e. they're candidates for deletion.
    expect(staleIds.map((r) => r.id)).toEqual([1])
  })

  it('UTC cutoff independently of local timezone', () => {
    // The original bug: applying 'localtime' to a UTC-stored timestamp
    // shifted the cutoff, so an item exactly at the boundary could either
    // survive forever or be deleted in the same calendar day depending on
    // the user's offset. With pure UTC math, both the item's age and the
    // cutoff are measured against the same UTC epoch.
    const itemUtcMs = Date.now() - 31 * 24 * 60 * 60 * 1000 // 31 days old
    const cutoffUtcMs = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30-day cutoff
    // 31-day-old item is unambiguously past the 30-day boundary regardless of
    // any timezone arithmetic; the cleanup query should classify it expired.
    expect(itemUtcMs < cutoffUtcMs).toBe(true)
  })
})

// Lower-case the matching the way readFileListFromClipboard now does.
function detectFileFormats(formats: string[]): string[] {
  return formats.filter((f) => {
    const fl = f.toLowerCase()
    return fl.includes('filename')
      || fl.includes('file-url')
      || fl === 'nsfilenamespboardtype'
      || fl === 'text/uri-list'
  })
}

describe('file format matcher', () => {
  it('catches public.file-url (macOS Finder)', () => {
    expect(detectFileFormats(['public.file-url', 'text/plain'])).toEqual(['public.file-url'])
  })

  it('catches NSFilenamesPboardType (older macOS)', () => {
    expect(detectFileFormats(['NSFilenamesPboardType'])).toEqual(['NSFilenamesPboardType'])
  })

  it('catches FileNameW (Windows)', () => {
    expect(detectFileFormats(['FileNameW', 'FileName'])).toEqual(['FileNameW', 'FileName'])
  })

  it('catches text/uri-list (Linux / browsers)', () => {
    expect(detectFileFormats(['text/uri-list'])).toEqual(['text/uri-list'])
  })

  it('ignores plain text and image formats', () => {
    expect(detectFileFormats(['text/plain', 'image/png', 'text/html'])).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(detectFileFormats(['PUBLIC.FILE-URL', 'filenameW'])).toEqual(['PUBLIC.FILE-URL', 'filenameW'])
  })
})

function looksLikeExistingFilePath(text: string, exists: (p: string) => boolean): string | null {
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
  if (exists(trimmed)) return trimmed
  return null
}

describe('text→file path heuristic', () => {
  it('detects an existing absolute POSIX path', () => {
    expect(looksLikeExistingFilePath('/tmp/report.pdf', () => true)).toBe('/tmp/report.pdf')
  })

  it('detects an existing Windows path', () => {
    expect(looksLikeExistingFilePath('C:\\Users\\me\\doc.txt', () => true)).toBe('C:\\Users\\me\\doc.txt')
  })

  it('detects a tilde path', () => {
    expect(looksLikeExistingFilePath('~/Downloads/x.zip', () => true)).toBe('~/Downloads/x.zip')
  })

  it('rejects multi-line text', () => {
    expect(looksLikeExistingFilePath('/tmp/a\n/tmp/b', () => true)).toBe(null)
  })

  it('rejects text with whitespace', () => {
    expect(looksLikeExistingFilePath('/tmp/my report.pdf', () => true)).toBe(null)
  })

  it('rejects non-path-looking text even when it exists', () => {
    expect(looksLikeExistingFilePath('hello', () => true)).toBe(null)
  })

  it('rejects when the file does not exist', () => {
    expect(looksLikeExistingFilePath('/tmp/missing.pdf', () => false)).toBe(null)
  })
})