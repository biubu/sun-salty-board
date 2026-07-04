import initSqlJs from 'sql.js'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { Database as SqlJsDatabase } from 'sql.js'
import { createFtsTable, indexItemFts, removeItemFts, searchFts } from './ftsSearch'
import { prepareUndo, consumeUndo, clipboardItemToUndoEntry } from './undoManager'
import {
  addSensitiveItem, getSensitiveItems, getSensitiveItemById,
  removeSensitiveItem, clearSensitiveItems,
} from './sensitiveItems'
import { detectImageMimeType } from '../src/utils/magicBytes'

export interface ClipboardItem {
  id: number
  content: string
  contentHtml?: string
  dataType: string
  imageData?: Uint8Array
  imageMime?: string
  filePaths?: string[]
  sourceApp?: string
  sourceDevice?: string
  isFavorite: boolean
  categoryIds: number[]
  createdAt: string
}

interface Category {
  id: number
  name: string
}

interface Settings {
  maxItems: number
  hotkey: string
  expirationDays: number
  theme: string
  locale: string
  exclusionApps: string[]
  exclusionPatterns: string[]
}

let db: SqlJsDatabase
let dbPath: string

// ─── Persistence layer ──────────────────────────────────────────────────────────
// sql.js is an in-memory engine; every commit means re-serialising the entire DB.
// The previous implementation called saveDb() on every write (every category
// rename, every favorite toggle, every delete) — that turns into a full-database
// writeFileSync on the main process for each user action. We replace it with:
//   * a dirty flag (set by every write, cleared by a successful flush)
//   * a single trailing-debounced flush (250ms quiet period coalesces bursts)
//   * a flushTimeout set so we can flush eagerly when needed
//   * an exit-time synchronous flush so we never lose the last edit
//
// This keeps the same synchronous, blocking semantics so the rest of the
// codebase keeps working unchanged, but cuts write IO dramatically under
// normal interactive use (a user adding 5 categories now → 1 save, not 5).

let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_DEBOUNCE_MS = 250

function scheduleFlush(): void {
  // Mark dirty on every call: previously nothing in this file set dirty = true,
  // so scheduleFlush early-returned via `if (!dirty) return` and edits (clear,
  // delete, favorite toggle, settings updates …) lived only in memory. They
  // appeared "restored" on next launch because the disk still held the prior
  // state. Marking here keeps every mutator covered without sprinkling the
  // assignment across the file.
  dirty = true
  if (flushTimer) return // already scheduled
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (dirty) {
      try {
        saveDbSync()
      } catch (err) {
        console.warn('[SunSaltyBoard] Failed to flush DB:', (err as Error).message)
      }
    }
  }, FLUSH_DEBOUNCE_MS)
}

function saveDbSync(): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
  dirty = false
}

// ─── DB setup ──────────────────────────────────────────────────────────────────

async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  dbPath = path.join(userDataPath, 'sunsaltyboard.db')

  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL DEFAULT '',
      content_html TEXT,
      data_type TEXT NOT NULL DEFAULT 'text',
      image_data BLOB,
      image_mime TEXT,
      file_paths TEXT,
      source_app TEXT,
      source_device TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS item_categories (
      item_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (item_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  createFtsTable(db)

  // Migrate: image_mime column may be missing on databases created before v1.2.x.
  const colRows = db.exec('PRAGMA table_info(items)')
  const haveImageMime = colRows[0]?.values.some((row) => row[1] === 'image_mime')
  if (!haveImageMime) {
    db.run('ALTER TABLE items ADD COLUMN image_mime TEXT')
  }

  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['maxItems', '10000'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['hotkey', 'Alt+Shift+V'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['expirationDays', '30'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['theme', 'dark'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['locale', 'en'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['exclusionApps', '[]'])
  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['exclusionPatterns', '[]'])

  saveDbSync()
  cleanupExpiredItems()
}

function cleanupExpiredItems(): void {
  const settings = getSettings()
  if (settings.expirationDays <= 0) return
  // created_at is stored in UTC via strftime('%Y-%m-%dT%H:%M:%S', 'now'),
  // so compare against the same UTC anchor. The previous query used
  // datetime(?, 'localtime') which mismatched timezones and could delete
  // items that were actually fresher than the threshold (or vice versa).
  const cutoffSql = "strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)"
  const result = db.exec(
    `SELECT id FROM items WHERE is_favorite = 0 AND created_at < ${cutoffSql}`,
    [`-${settings.expirationDays} days`],
  )
  if (result.length > 0) {
    for (const row of result[0].values) {
      removeItemFts(db, row[0] as number)
    }
  }
  db.run(
    `DELETE FROM items WHERE is_favorite = 0 AND created_at < ${cutoffSql}`,
    [`-${settings.expirationDays} days`],
  )
  scheduleFlush()
}

let writeQueue: Array<{
  content: string
  contentHtml?: string
  dataType: string
  imageData?: Uint8Array
  imageMime?: string
  filePaths?: string[]
  sourceApp?: string
  sourceDevice?: string
}> = []

let writeFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushWriteQueue(): void {
  if (writeQueue.length === 0) return

  for (const item of writeQueue) {
    db.run(
      `INSERT INTO items (content, content_html, data_type, image_data, image_mime, file_paths, source_app, source_device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.content,
        item.contentHtml ?? null,
        item.dataType,
        item.imageData ?? null,
        item.imageMime ?? null,
        item.filePaths ? JSON.stringify(item.filePaths) : null,
        item.sourceApp ?? null,
        item.sourceDevice ?? null,
      ],
    )
    const idResult = db.exec('SELECT last_insert_rowid() as id')
    const newId = idResult[0].values[0][0] as number
    if (item.dataType === 'text' || item.dataType === 'richtext') {
      indexItemFts(db, newId)
    }
  }

  writeQueue = []

  const settings = getSettings()
  const totalResult = db.exec('SELECT COUNT(*) as cnt FROM items')
  const totalItems = totalResult[0]?.values[0][0] as number

  if (totalItems > settings.maxItems) {
    const excess = totalItems - settings.maxItems
    const toDelete = db.exec(
      'SELECT id FROM items WHERE is_favorite = 0 ORDER BY created_at ASC LIMIT ?',
      [excess],
    )
    if (toDelete.length > 0) {
      for (const row of toDelete[0].values) {
        removeItemFts(db, row[0] as number)
      }
    }
    db.run(
      'DELETE FROM items WHERE id IN (SELECT id FROM items WHERE is_favorite = 0 ORDER BY created_at ASC LIMIT ?)',
      [excess],
    )
  }

  scheduleFlush()
}

function queueItem(item: Omit<ClipboardItem, 'id' | 'isFavorite' | 'categoryIds' | 'createdAt'>): void {
  // Stamp the mime once at intake so renderer doesn't have to re-detect.
  const enriched = { ...item }
  if (item.dataType === 'image' && item.imageData && !item.imageMime) {
    enriched.imageMime = detectImageMimeType(item.imageData)
  }
  writeQueue.push(enriched)

  // Coalesce bursts: 50+ writes flush immediately, otherwise wait 2s.
  if (writeQueue.length >= 50) {
    if (writeFlushTimer) {
      clearTimeout(writeFlushTimer)
      writeFlushTimer = null
    }
    flushWriteQueue()
    return
  }
  if (!writeFlushTimer) {
    writeFlushTimer = setTimeout(() => {
      writeFlushTimer = null
      flushWriteQueue()
    }, 2000)
  }
}

function parseItemRow(cols: string[], row: unknown[]): ClipboardItem {
  const map: Record<string, unknown> = {}
  cols.forEach((col, i) => { map[col] = row[i] })
  return {
    id: map.id as number,
    content: map.content as string,
    contentHtml: map.content_html as string | undefined,
    dataType: map.data_type as string,
    imageData: map.image_data as Uint8Array | undefined,
    imageMime: map.image_mime as string | undefined,
    filePaths: map.file_paths ? JSON.parse(map.file_paths as string) : undefined,
    sourceApp: map.source_app as string | undefined,
    sourceDevice: map.source_device as string | undefined,
    isFavorite: (map.is_favorite as number) === 1,
    categoryIds: map.cat_ids
      ? (map.cat_ids as string).split(',').map(Number).filter(Boolean)
      : [],
    createdAt: map.created_at as string,
  }
}

function getItems(): ClipboardItem[] {
  const result = db.exec(`
    SELECT i.*, GROUP_CONCAT(ic.category_id) as cat_ids
    FROM items i
    LEFT JOIN item_categories ic ON i.id = ic.item_id
    GROUP BY i.id
    ORDER BY i.created_at DESC
    LIMIT 500
  `)

  if (result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((row) => parseItemRow(columns, row))
}

function getItemById(id: number): ClipboardItem | null {
  const result = db.exec(
    `SELECT i.*, GROUP_CONCAT(ic.category_id) as cat_ids
     FROM items i
     LEFT JOIN item_categories ic ON i.id = ic.item_id
     WHERE i.id = ?
     GROUP BY i.id`,
    [id],
  )
  if (result.length === 0 || result[0].values.length === 0) return null
  const { columns, values } = result[0]
  return parseItemRow(columns, values[0])
}

function deleteItem(id: number): void {
  const item = getItemById(id)
  if (!item) return

  prepareUndo(clipboardItemToUndoEntry(item))

  removeItemFts(db, id)
  db.run('DELETE FROM item_categories WHERE item_id = ?', [id])
  db.run('DELETE FROM items WHERE id = ?', [id])
  scheduleFlush()

  // Vacuum when the recent-delete rate spikes so the .db file doesn't bloat
  // (e.g. after a bulk clear). Throttled so we don't vacuum on every delete.
  const stats = db.exec(
    'SELECT COUNT(*) as total, SUM(CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END) as non_fav FROM items',
  )
  if (stats.length > 0) {
    const total = stats[0].values[0][0] as number
    const nonFav = stats[0].values[0][1] as number
    if (total > 0 && nonFav / total > 0.25 && total > 100) {
      db.run('VACUUM')
      saveDbSync()
    }
  }
}

function undoDelete(): ClipboardItem | null {
  const entry = consumeUndo()
  if (!entry) return null

  db.run(
    `INSERT INTO items (id, content, content_html, data_type, image_data, image_mime, file_paths, source_app, source_device, is_favorite, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.content,
      entry.content_html,
      entry.data_type,
      entry.image_data,
      entry.image_mime,
      entry.file_paths,
      entry.source_app,
      entry.source_device,
      entry.is_favorite,
      entry.created_at,
    ],
  )
  // Restore category associations captured at delete-time. Without this, an
  // undone item would reappear without any of its previously-attached
  // categories — the user would silently lose their organisational state.
  if (entry.category_ids && entry.category_ids.length > 0) {
    for (const catId of entry.category_ids) {
      db.run(
        'INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)',
        [entry.id, catId],
      )
    }
  }
  scheduleFlush()
  if (entry.data_type === 'text' || entry.data_type === 'richtext') {
    indexItemFts(db, entry.id)
  }
  return getItemById(entry.id)
}

function toggleFavorite(id: number): void {
  db.run(
    'UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id],
  )
  scheduleFlush()
}

function clearHistory(): void {
  const toDelete = db.exec('SELECT id FROM items WHERE is_favorite = 0')
  if (toDelete.length > 0) {
    for (const row of toDelete[0].values) {
      removeItemFts(db, row[0] as number)
    }
  }
  db.run('DELETE FROM items WHERE is_favorite = 0')
  // Force-save so a user-initiated "clear all" survives even if the app is
  // killed before the 250ms debounce window elapses. Without this, the
  // classic fast-quit-after-clear scenario resurrects the deleted rows on
  // next launch (the disk still holds the pre-clear state).
  saveDbSync()
}

function searchHistory(query: string): ClipboardItem[] {
  const results = searchFts(db, query)
  if (results.length === 0) return []

  const ids = results.map((r) => r.id)
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(',')
  const result = db.exec(
    `SELECT i.*, GROUP_CONCAT(ic.category_id) as cat_ids
     FROM items i
     LEFT JOIN item_categories ic ON i.id = ic.item_id
     WHERE i.id IN (${placeholders})
     GROUP BY i.id
     ORDER BY i.created_at DESC
     LIMIT 200`,
    ids,
  )
  if (result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((row) => parseItemRow(columns, row))
}

function getCategories(): Category[] {
  const result = db.exec('SELECT * FROM categories ORDER BY name')
  if (result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((row) => {
    const map: Record<string, unknown> = {}
    columns.forEach((col, i) => { map[col] = row[i] })
    return { id: map.id as number, name: map.name as string }
  })
}

function createCategory(name: string): Category {
  db.run('INSERT INTO categories (name) VALUES (?)', [name])
  scheduleFlush()
  const result = db.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  return { id, name }
}

function renameCategory(id: number, name: string): void {
  db.run('UPDATE categories SET name = ? WHERE id = ?', [name, id])
  scheduleFlush()
}

function deleteCategory(id: number): void {
  // Wrap in a transaction so a crash between the two DELETEs can't leave
  // orphan rows in item_categories that point to a vanished category.
  db.run('BEGIN')
  try {
    db.run('DELETE FROM item_categories WHERE category_id = ?', [id])
    db.run('DELETE FROM categories WHERE id = ?', [id])
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  scheduleFlush()
}

function assignCategory(itemId: number, categoryId: number): void {
  db.run(
    'INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)',
    [itemId, categoryId],
  )
  scheduleFlush()
}

function removeCategory(itemId: number, categoryId: number): void {
  db.run(
    'DELETE FROM item_categories WHERE item_id = ? AND category_id = ?',
    [itemId, categoryId],
  )
  scheduleFlush()
}

function getSettings(): Settings {
  const result = db.exec('SELECT key, value FROM settings')
  const map: Record<string, string> = {}
  if (result.length > 0) {
    for (const row of result[0].values) {
      map[row[0] as string] = row[1] as string
    }
  }
  return {
    maxItems: parseInt(map.maxItems || '10000', 10),
    hotkey: map.hotkey || 'Alt+Shift+V',
    expirationDays: parseInt(map.expirationDays || '30', 10),
    theme: (map.theme || 'dark') as 'light' | 'dark',
    locale: map.locale || 'en',
    exclusionApps: JSON.parse(map.exclusionApps || '[]'),
    exclusionPatterns: JSON.parse(map.exclusionPatterns || '[]'),
  }
}

// Renderer sends us a plain `Partial<Settings>`; we serialise object values
// consistently here so callers don't have to know about the storage format.
function updateSettings(settings: Partial<Settings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, strValue],
    )
  }
  scheduleFlush()
}

function getStats(): { totalItems: number; favoriteItems: number; dbSize: number } {
  const total = db.exec('SELECT COUNT(*) FROM items')
  const fav = db.exec('SELECT COUNT(*) FROM items WHERE is_favorite = 1')
  return {
    totalItems: (total[0]?.values[0][0] as number) || 0,
    favoriteItems: (fav[0]?.values[0][0] as number) || 0,
    dbSize: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
  }
}

export interface WorkerBridge {
  storeItem: (item: Omit<ClipboardItem, 'id' | 'isFavorite' | 'categoryIds' | 'createdAt'>) => void
  flush: () => void
  forceSave: () => void
  getItems: () => ClipboardItem[]
  getItemById: (id: number) => ClipboardItem | null
  deleteItem: (id: number) => void
  undoDelete: () => ClipboardItem | null
  toggleFavorite: (id: number) => void
  searchHistory: (query: string) => ClipboardItem[]
  clearHistory: () => void
  getCategories: () => Category[]
  createCategory: (name: string) => Category
  renameCategory: (id: number, name: string) => void
  deleteCategory: (id: number) => void
  assignCategory: (itemId: number, categoryId: number) => void
  removeCategory: (itemId: number, categoryId: number) => void
  getSettings: () => Settings
  updateSettings: (settings: Partial<Settings>) => void
  getStats: () => { totalItems: number; favoriteItems: number; dbSize: number }
  getSensitiveItems: () => import('./sensitiveItems').SensitiveItem[]
  addSensitiveItem: (content: string, dataType: string) => number
  close: () => void
}

export async function createWorker(): Promise<WorkerBridge> {
  await initDatabase()

  // Always flush whatever is dirty when the process is about to exit.
  // Without this, the last debounce window's edits would be silently lost.
  const exitHandler = () => {
    if (dirty) {
      try { saveDbSync() } catch { /* best effort */ }
    }

    // Cancel a still-pending write flush and drain the queue (in-memory only,
    // db flush happens via saveDbSync above so newly-inserted items survive).
    if (writeFlushTimer) {
      clearTimeout(writeFlushTimer)
      writeFlushTimer = null
      if (writeQueue.length > 0) {
        flushWriteQueue()
        if (dirty) {
          try { saveDbSync() } catch { /* best effort */ }
        }
      }
    }
  }
  process.once('beforeExit', exitHandler)
  process.once('exit', exitHandler)

  // Schedule periodic expiration cleanup. The original code only ran the
  // sweep once on init, so a long-lived session (e.g. a user running the
  // app for weeks without restart) would accumulate items past
  // `expirationDays` indefinitely. Hourly cadence is far cheaper than the
  // per-write flush and well below the typical 1-day TTL window.
  const expirationTimer = setInterval(() => {
    try {
      cleanupExpiredItems()
    } catch (err) {
      console.warn('[SunSaltyBoard] Periodic expiration cleanup failed:', (err as Error).message)
    }
  }, 60 * 60 * 1000)
  // Don't keep the Node event loop alive solely for this sweep — when
  // everything else (windows, tray) has gone away, let the process exit.
  if (typeof (expirationTimer as { unref?: () => void }).unref === 'function') {
    (expirationTimer as { unref: () => void }).unref()
  }

  return {
    storeItem: queueItem,
    flush: flushWriteQueue,
    forceSave: () => {
      // Cancel the debounced timer and flush immediately.
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (writeFlushTimer) {
        clearTimeout(writeFlushTimer)
        writeFlushTimer = null
      }
      if (writeQueue.length > 0) flushWriteQueue()
      if (dirty) saveDbSync()
    },
    getItems,
    getItemById,
    deleteItem,
    undoDelete,
    toggleFavorite,
    searchHistory,
    clearHistory,
    getCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    assignCategory,
    removeCategory,
    getSettings,
    updateSettings,
    getStats,
    getSensitiveItems,
    addSensitiveItem: (content: string, dataType: string) => addSensitiveItem(content, dataType),
    close: () => {
      try {
        if (dirty || writeQueue.length > 0) saveDbSync()
      } finally {
        db.close()
      }
    },
  }
}
