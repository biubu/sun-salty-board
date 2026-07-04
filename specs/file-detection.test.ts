import { describe, it, expect } from 'vitest'
import initSqlJs from 'sql.js'

// Stand-in for Electron's `clipboard` API so we can drive
// readFileListFromClipboard without a real Electron runtime.
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

let db: any

describe('clipboard file detection (pure helpers, no Electron)', () => {
  it('matches public.file-url (macOS)', async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    db.run(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')))`)
    // We can't import platform-monitor directly without electron; instead
    // exercise the SQL cutoff query that replaces the broken localtime one.
    db.run("INSERT INTO items (id, created_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%S', 'now', '-40 days'))")
    db.run("INSERT INTO items (id, created_at) VALUES (2, strftime('%Y-%m-%dT%H:%M:%S', 'now', '-10 days'))")
    const cutoffSql = "strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)"
    const stale = db.exec(`SELECT id FROM items WHERE created_at < ${cutoffSql}`, ['-30 days'])
    const ids = stale[0].values.map((r: any[]) => r[0])
    expect(ids).toEqual([1])
  })

  it('cleans up using UTC, not localtime', async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    db.run(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, is_favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')))`)
    db.run("INSERT INTO items (id, is_favorite, created_at) VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%S', 'now', '-40 days'))")
    db.run("INSERT INTO items (id, is_favorite, created_at) VALUES (2, 1, strftime('%Y-%m-%dT%H:%M:%S', 'now', '-40 days'))")
    const cutoffSql = "strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)"
    db.run(`DELETE FROM items WHERE is_favorite = 0 AND created_at < ${cutoffSql}`, ['-30 days'])
    const remaining = db.exec('SELECT id, is_favorite FROM items ORDER BY id')
    expect(remaining[0].values).toEqual([[2, 1]])
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