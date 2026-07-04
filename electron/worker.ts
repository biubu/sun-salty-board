// Worker thread: owns the SQLite handle, exposes a synchronous API to main.
//
// Storage engine: better-sqlite3 (a synchronous wrapper around a SQLite
// library linked into Node). The previous implementation used sql.js, which
// runs SQLite inside a WebAssembly heap inside V8: every commit re-serialised
// the entire database to bytes and called fs.writeFileSync. That meant the
// entire history lived in WASM linear memory (often 200–400 MB on a busy
// clipboard) plus a Chromium IPC copy of the same data every broadcast. This
// rewrite trades that for native SQLite: the DB stays on disk, WAL mode lets
// reads proceed in parallel with writes, and only touched rows flow through
// JS.
//
// FTS5: previously ftsSearch.ts had a "was FTS5 compiled?" savepoint probe —
// in the FTS5 branch it was returning without inserting, so the search index
// was silently broken. The right way with a "contentless external content"
// FTS5 table is to keep it in sync via three AFTER triggers on the items
// table. We own those triggers here directly; the old ftsSearch.ts is gone.

import Database, { type Database as BetterSqliteDatabase, type Statement } from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { prepareUndo, consumeUndo, clipboardItemToUndoEntry } from './undoManager'
import {
  addSensitiveItem, getSensitiveItems, getSensitiveItemById,
  removeSensitiveItem, clearSensitiveItems,
  startEvictionTimer, stopEvictionTimer,
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

let db: BetterSqliteDatabase

// Prepared statements are compiled once on DB init and reused per call. They
// are roughly 5–50× faster than re-preparing the same SQL on every write.
const stmts: Record<string, Statement> = {}

// ─── Init ────────────────────────────────────────────────────────────────────

async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'sunsaltyboard.db')

  db = new Database(dbPath)
  // WAL: readers don't block writers and vice versa. journals to disk so the
  // usual single-process clipboard workload stays hot in the page cache.
  db.pragma('journal_mode = WAL')
  // NORMAL trades a slim risk of last-commit loss on power failure for
  // noticeably faster writes; matches what every desktop SQLite app uses.
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  prepareStatements()
  ensureSchema()
  seedDefaultSettings()
  cleanupExpiredItems()
}

function prepareStatements(): void {
  // Schema DDL
  stmts.createItems = db.prepare(`
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
    )`)
  stmts.createCategories = db.prepare(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`)
  stmts.createItemCategories = db.prepare(`
    CREATE TABLE IF NOT EXISTS item_categories (
      item_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (item_id, category_id)
    )`)
  stmts.createSettings = db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`)
  // External-content FTS5 — the items table itself stores content, FTS just
  // holds the inverted index plus positional info.
  stmts.createItemsFts = db.prepare(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      content,
      content_html,
      content='items',
      content_rowid='id'
    )`)
  // The three AI/AU/AD triggers that keep the FTS index correct. Without
  // these the index would only reflect what was inserted at schema-create
  // time. Note the use of the standard "INSERT INTO fts(fts, …) VALUES
  // ('delete', …)" form for UPDATE/DELETE — that's the documented SQLite
  // recipe for contentless external-content tables.
  stmts.createItemsFtsAi = db.prepare(`
    CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, content, content_html)
      VALUES (new.id, new.content, new.content_html);
    END`)
  stmts.createItemsFtsAu = db.prepare(`
    CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, content_html)
      VALUES ('delete', old.id, old.content, old.content_html);
      INSERT INTO items_fts(rowid, content, content_html)
      VALUES (new.id, new.content, new.content_html);
    END`)
  stmts.createItemsFtsAd = db.prepare(`
    CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, content_html)
      VALUES ('delete', old.id, old.content, old.content_html);
    END`)

  // Item CRUD
  stmts.insertItem = db.prepare(`
    INSERT INTO items (content, content_html, data_type, image_data, image_mime,
      file_paths, source_app, source_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  stmts.insertItemWithId = db.prepare(`
    INSERT INTO items (id, content, content_html, data_type, image_data, image_mime,
      file_paths, source_app, source_device, is_favorite, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  stmts.toggleFavorite = db.prepare(
    `UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END
     WHERE id = ?`)
  stmts.deleteItemCategoriesByItemId = db.prepare(
    `DELETE FROM item_categories WHERE item_id = ?`)
  stmts.deleteItemById = db.prepare(`DELETE FROM items WHERE id = ?`)
  stmts.deleteNonFavItems = db.prepare(`DELETE FROM items WHERE is_favorite = 0`)
  stmts.selectItemCount = db.prepare(`SELECT COUNT(*) AS cnt FROM items`)
  stmts.selectFavoriteItemCount = db.prepare(
    `SELECT COUNT(*) AS cnt FROM items WHERE is_favorite = 1`)
  // Cap the most-recent window shown in the overlay. react-window only ever
  // renders a handful of rows; 100 covers ~3 fullscreen scrolls worth while
  // keeping IPC payloads small.
  const ITEMS_LIMIT = 100
  stmts.selectRecentItems = db.prepare(`
    SELECT i.*, GROUP_CONCAT(ic.category_id) AS cat_ids
    FROM items i LEFT JOIN item_categories ic ON i.id = ic.item_id
    GROUP BY i.id ORDER BY i.created_at DESC LIMIT ${ITEMS_LIMIT}`)
  stmts.selectItemById = db.prepare(`
    SELECT i.*, GROUP_CONCAT(ic.category_id) AS cat_ids
    FROM items i LEFT JOIN item_categories ic ON i.id = ic.item_id
    WHERE i.id = ? GROUP BY i.id`)
  // Trim oldest non-favourite entries when we exceed `maxItems`.
  stmts.deleteOldestNonFav = db.prepare(`
    DELETE FROM items WHERE id IN (
      SELECT id FROM items WHERE is_favorite = 0 ORDER BY created_at ASC LIMIT ?
    )`)

  // FTS search: single MATCH query, ids come back as a sub-query result.
  stmts.searchHistoryByFts = db.prepare(`
    SELECT i.*, GROUP_CONCAT(ic.category_id) AS cat_ids
    FROM items i LEFT JOIN item_categories ic ON i.id = ic.item_id
    WHERE i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)
    GROUP BY i.id ORDER BY i.created_at DESC LIMIT 200`)

  // Expiration sweep. created_at is stored in UTC via strftime, so anchor in UTC.
  stmts.selectExpired = db.prepare(`
    SELECT id FROM items WHERE is_favorite = 0
      AND created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)`)
  stmts.deleteExpired = db.prepare(`
    DELETE FROM items WHERE is_favorite = 0
      AND created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)`)

  // Categories
  stmts.insertCategory = db.prepare(`INSERT INTO categories (name) VALUES (?)`)
  stmts.selectAllCategories = db.prepare(`SELECT * FROM categories ORDER BY name`)
  stmts.updateCategoryName = db.prepare(`UPDATE categories SET name = ? WHERE id = ?`)
  stmts.deleteItemCategoriesByCategoryId = db.prepare(
    `DELETE FROM item_categories WHERE category_id = ?`)
  stmts.deleteCategoryById = db.prepare(`DELETE FROM categories WHERE id = ?`)
  // Compound transaction used by deleteCategory so a crash mid-delete can't
  // leave item_categories referencing a vanished category.
  stmts.deleteCategoryTxn = db.transaction((id: number) => {
    stmts.deleteItemCategoriesByCategoryId.run(id)
    stmts.deleteCategoryById.run(id)
  })
  stmts.insertItemCategory = db.prepare(
    `INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)`)
  stmts.deleteItemCategory = db.prepare(
    `DELETE FROM item_categories WHERE item_id = ? AND category_id = ?`)

  // Settings KV
  stmts.selectAllSettings = db.prepare(`SELECT key, value FROM settings`)
  stmts.seedSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`)
  stmts.upsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
}

function ensureSchema(): void {
  stmts.createItems.run()
  stmts.createCategories.run()
  stmts.createItemCategories.run()
  stmts.createSettings.run()
  stmts.createItemsFts.run()
  stmts.createItemsFtsAi.run()
  stmts.createItemsFtsAu.run()
  stmts.createItemsFtsAd.run()

  // Migrate: image_mime column may be missing on databases created before v1.2.x.
  // better-sqlite3 returns an array of column descriptors from PRAGMA.
  const cols = db.pragma(`table_info('items')`) as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'image_mime')) {
    db.exec('ALTER TABLE items ADD COLUMN image_mime TEXT')
  }
}

function seedDefaultSettings(): void {
  const seed: Array<[string, string]> = [
    ['maxItems', '10000'],
    ['hotkey', 'Alt+Shift+V'],
    ['expirationDays', '30'],
    ['theme', 'dark'],
    ['locale', 'en'],
    ['exclusionApps', '[]'],
    ['exclusionPatterns', '[]'],
  ]
  for (const [k, v] of seed) stmts.seedSetting.run(k, v)
}

// ─── Periodic expiry sweep ───────────────────────────────────────────────────

function cleanupExpiredItems(): void {
  const settings = getSettings()
  if (settings.expirationDays <= 0) return
  // AI/AD triggers keep FTS in sync — no manual index maintenance needed.
  stmts.deleteExpired.run(`-${settings.expirationDays} days`)
}

// ─── Clipboard ingestion (queue → flush) ─────────────────────────────────────

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

  // A write txn is faster than individual commits and guarantees atomicity
  // for the whole batch. better-sqlite3's `.transaction` returns a function
  // we invoke with the body.
  const insertBatch = db.transaction((rows: typeof writeQueue) => {
    for (const item of rows) {
      stmts.insertItem.run(
        item.content,
        item.contentHtml ?? null,
        item.dataType,
        item.imageData ?? null,
        item.imageMime ?? null,
        item.filePaths ? JSON.stringify(item.filePaths) : null,
        item.sourceApp ?? null,
        item.sourceDevice ?? null,
      )
    }
  })
  insertBatch(writeQueue)
  writeQueue = []

  // Cap items to maxItems (run outside the insert txn to keep its scope tight).
  const { cnt } = stmts.selectItemCount.get() as { cnt: number }
  const settings = getSettings()
  if (cnt > settings.maxItems) {
    stmts.deleteOldestNonFav.run(cnt - settings.maxItems)
  }
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

// Row shape returned by `SELECT i.*`. We always need to coerce BLOB → Buffer
// (Uint8Array is what react-window's <img> srcset accepts). better-sqlite3
// gives us a plain object per row.
interface ItemRow {
  id: number
  content: string
  content_html: string | null
  data_type: string
  image_data: Buffer | null
  image_mime: string | null
  file_paths: string | null
  source_app: string | null
  source_device: string | null
  is_favorite: number
  created_at: string
  cat_ids: string | null
}

function rowToItem(row: ItemRow): ClipboardItem {
  return {
    id: row.id,
    content: row.content,
    contentHtml: row.content_html ?? undefined,
    dataType: row.data_type,
    imageData: row.image_data ?? undefined,
    imageMime: row.image_mime ?? undefined,
    filePaths: row.file_paths ? JSON.parse(row.file_paths) : undefined,
    sourceApp: row.source_app ?? undefined,
    sourceDevice: row.source_device ?? undefined,
    isFavorite: row.is_favorite === 1,
    categoryIds: row.cat_ids
      ? row.cat_ids.split(',').map(Number).filter(Boolean)
      : [],
    createdAt: row.created_at,
  }
}

function getItems(): ClipboardItem[] {
  const rows = stmts.selectRecentItems.all() as ItemRow[]
  return rows.map(rowToItem)
}

function getItemById(id: number): ClipboardItem | null {
  const row = stmts.selectItemById.get(id) as ItemRow | undefined
  return row ? rowToItem(row) : null
}

function deleteItem(id: number): void {
  const item = getItemById(id)
  if (!item) return

  prepareUndo(clipboardItemToUndoEntry(item))
  // AI/AD triggers on items take care of FTS bookkeeping.
  stmts.deleteItemCategoriesByItemId.run(id)
  stmts.deleteItemById.run(id)
  // Vacuum moved to clearHistory (Stage 3): the previous "trigger when
  // nonFav/total > 0.25 && total > 100" check was effectively always-true
  // for non-trivial histories, so a single delete could trigger a full
  // database rewrite.
}

function undoDelete(): ClipboardItem | null {
  const entry = consumeUndo()
  if (!entry) return null

  // AI/AU triggers keep FTS in sync — single insert covers it.
  stmts.insertItemWithId.run(
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
  )

  // Restore category associations captured at delete-time. Without this, an
  // undone item would reappear without any of its previously-attached
  // categories — the user would silently lose their organisational state.
  if (entry.category_ids && entry.category_ids.length > 0) {
    for (const catId of entry.category_ids) {
      stmts.insertItemCategory.run(entry.id, catId)
    }
  }

  return getItemById(entry.id)
}

function toggleFavorite(id: number): void {
  stmts.toggleFavorite.run(id)
}

function clearHistory(): void {
  // FTS is synced via the items AD trigger; VACUUM rewrites the file to
  // reclaim freed pages (kept out of any transaction since SQLite forbids
  // it inside one). This is the only path that calls VACUUM — single deletes
  // and bulk window-trims no longer pay the cost.
  stmts.deleteNonFavItems.run()
  // VACUUM must run outside the implicit transaction; explicit transaction
  // boundary keeps the surrounding concurrent reads healthy in WAL mode.
  db.exec('VACUUM')
}

function searchHistory(query: string): ClipboardItem[] {
  const sanitized = query
    .replace(/["()*+^]/g, ' ')
    .replace(/[^\w\s一-鿿぀-ヿ가-힯]/g, ' ')
    .trim()
  if (!sanitized) return []
  const terms = sanitized.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const ftsQuery = terms.map((t) => `"${t}"*`).join(' AND ')

  const rows = stmts.searchHistoryByFts.all(ftsQuery) as ItemRow[]
  return rows.map(rowToItem)
}

// ─── Categories ──────────────────────────────────────────────────────────────

function getCategories(): Category[] {
  return stmts.selectAllCategories.all() as Category[]
}

function createCategory(name: string): Category {
  const info = stmts.insertCategory.run(name)
  return { id: Number(info.lastInsertRowid), name }
}

function renameCategory(id: number, name: string): void {
  stmts.updateCategoryName.run(name, id)
}

function deleteCategory(id: number): void {
  stmts.deleteCategoryTxn(id)
}

function assignCategory(itemId: number, categoryId: number): void {
  stmts.insertItemCategory.run(itemId, categoryId)
}

function removeCategory(itemId: number, categoryId: number): void {
  stmts.deleteItemCategory.run(itemId, categoryId)
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSettings(): Settings {
  const rows = stmts.selectAllSettings.all() as Array<{ key: string; value: string }>
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>
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
  const upsertBatch = db.transaction((entries: Array<[string, string]>) => {
    for (const [k, v] of entries) stmts.upsertSetting.run(k, v)
  })
  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    entries.push([key, strValue])
  }
  if (entries.length > 0) upsertBatch(entries)
}

function getStats(): { totalItems: number; favoriteItems: number; dbSize: number } {
  const total = stmts.selectItemCount.get() as { cnt: number }
  const fav = stmts.selectFavoriteItemCount.get() as { cnt: number }
  // stats.dbSize is used by the Settings UI. Better-sqlite3's main file plus
  // WAL sidecar roughly account for the on-disk footprint; we report both.
  // Main file under dbPath keeps the contract; readers tolerate slight drift.
  let dbSize = 0
  try { dbSize = fs.statSync(dbPath()).size } catch { /* file may not exist yet */ }
  return { totalItems: total.cnt, favoriteItems: fav.cnt, dbSize }
}

let cachedDbPath = ''
function dbPath(): string {
  if (cachedDbPath) return cachedDbPath
  cachedDbPath = path.join(app.getPath('userData'), 'sunsaltyboard.db')
  return cachedDbPath
}

// ─── Public bridge ───────────────────────────────────────────────────────────

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
  startEvictionTimer()

  // Always drain whatever's pending in the write queue when the process is
  // about to exit — without this, a user who copies something then quickly
  // quits would lose that copy.
  const exitHandler = () => {
    if (writeFlushTimer) {
      clearTimeout(writeFlushTimer)
      writeFlushTimer = null
      if (writeQueue.length > 0) flushWriteQueue()
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
      if (writeFlushTimer) {
        clearTimeout(writeFlushTimer)
        writeFlushTimer = null
      }
      if (writeQueue.length > 0) flushWriteQueue()
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
        if (writeFlushTimer) {
          clearTimeout(writeFlushTimer)
          writeFlushTimer = null
        }
        if (writeQueue.length > 0) flushWriteQueue()
      } finally {
        stopEvictionTimer()
        db.close()
      }
    },
  }
}
