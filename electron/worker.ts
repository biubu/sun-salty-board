import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { createFtsTable, indexItemFts, removeItemFts, searchFts } from './ftsSearch'
import { prepareUndo, consumeUndo } from './undoManager'
import { addSensitiveItem, getSensitiveItems, getSensitiveItemById, removeSensitiveItem, clearSensitiveItems } from './sensitiveItems'

interface ClipboardItem {
  id: number
  content: string
  contentHtml?: string
  dataType: string
  imageData?: Uint8Array
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
  syncEnabled: boolean
  theme: string
  exclusionApps: string[]
  exclusionPatterns: string[]
}

let db: SqlJsDatabase
let dbPath: string

function saveDb(): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

function initDatabase(): void {
  const userDataPath = app.getPath('userData')
  dbPath = path.join(userDataPath, 'sunsaltyboard.db')

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new (require('sql.js').Database)(fileBuffer)
  } else {
    db = new (require('sql.js').Database)()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL DEFAULT '',
      content_html TEXT,
      data_type TEXT NOT NULL DEFAULT 'text',
      image_data BLOB,
      file_paths TEXT,
      source_app TEXT,
      source_device TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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

  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['maxItems', '10000'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['hotkey', 'Alt+Shift+V'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['expirationDays', '30'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['syncEnabled', 'false'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['theme', 'dark'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['exclusionApps', '[]'],
  )
  db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['exclusionPatterns', '[]'],
  )

  saveDb()
  cleanupExpiredItems()
}

function cleanupExpiredItems(): void {
  const settings = getSettings()
  if (settings.expirationDays <= 0) return
  const result = db.exec(
    'SELECT id FROM items WHERE is_favorite = 0 AND created_at < datetime(?, \'localtime\')',
    [`-${settings.expirationDays} days`],
  )
  if (result.length > 0) {
    for (const row of result[0].values) {
      removeItemFts(db, row[0] as number)
    }
  }
  db.run(
    'DELETE FROM items WHERE is_favorite = 0 AND created_at < datetime(?, \'localtime\')',
    [`-${settings.expirationDays} days`],
  )
  saveDb()
}

let writeQueue: Array<{
  content: string
  contentHtml?: string
  dataType: string
  imageData?: Uint8Array
  filePaths?: string[]
  sourceApp?: string
  sourceDevice?: string
}> = []

let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushWriteQueue(): void {
  if (writeQueue.length === 0) return

  for (const item of writeQueue) {
    db.run(
      `INSERT INTO items (content, content_html, data_type, image_data, file_paths, source_app, source_device)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.content,
        item.contentHtml ?? null,
        item.dataType,
        item.imageData ?? null,
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
  const totalItems = db.exec(
    'SELECT COUNT(*) as cnt FROM items',
  )[0]?.values[0][0] as number

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

  saveDb()
}

function queueItem(item: Omit<ClipboardItem, 'id' | 'isFavorite' | 'categoryIds' | 'createdAt'>): void {
  writeQueue.push(item)

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushWriteQueue()
    }, 2000)
  }

  if (writeQueue.length >= 50) {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushWriteQueue()
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

  prepareUndo('items', id, {
    content: item.content,
    content_html: item.contentHtml ?? null,
    data_type: item.dataType,
    image_data: item.imageData ?? null,
    file_paths: item.filePaths ? JSON.stringify(item.filePaths) : null,
    source_app: item.sourceApp ?? null,
    source_device: item.sourceDevice ?? null,
    is_favorite: item.isFavorite ? 1 : 0,
    created_at: item.createdAt,
  })

  removeItemFts(db, id)
  db.run('DELETE FROM item_categories WHERE item_id = ?', [id])
  db.run('DELETE FROM items WHERE id = ?', [id])
  saveDb()

  const stats = db.exec(
    'SELECT COUNT(*) as total, SUM(CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END) as non_fav FROM items',
  )
  if (stats.length > 0) {
    const total = stats[0].values[0][0] as number
    const nonFav = stats[0].values[0][1] as number
    if (total > 0 && nonFav / total > 0.25) {
      db.run('VACUUM')
      saveDb()
    }
  }
}

function undoDelete(): ClipboardItem | null {
  const entry = consumeUndo()
  if (!entry || entry.table !== 'items') return null

  db.run(
    `INSERT INTO items (id, content, content_html, data_type, image_data, file_paths, source_app, source_device, is_favorite, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.rowId,
      entry.data.content,
      entry.data.content_html,
      entry.data.data_type,
      entry.data.image_data,
      entry.data.file_paths,
      entry.data.source_app,
      entry.data.source_device,
      entry.data.is_favorite,
      entry.data.created_at,
    ],
  )
  saveDb()
  if (entry.data.data_type === 'text' || entry.data.data_type === 'richtext') {
    indexItemFts(db, entry.rowId)
  }
  return getItemById(entry.rowId)
}

function toggleFavorite(id: number): void {
  db.run(
    'UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id],
  )
  saveDb()
}

function clearHistory(): void {
  const toDelete = db.exec('SELECT id FROM items WHERE is_favorite = 0')
  if (toDelete.length > 0) {
    for (const row of toDelete[0].values) {
      removeItemFts(db, row[0] as number)
    }
  }
  db.run('DELETE FROM items WHERE is_favorite = 0')
  saveDb()
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
  saveDb()
  const result = db.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  return { id, name }
}

function renameCategory(id: number, name: string): void {
  db.run('UPDATE categories SET name = ? WHERE id = ?', [name, id])
  saveDb()
}

function deleteCategory(id: number): void {
  db.run('DELETE FROM item_categories WHERE category_id = ?', [id])
  db.run('DELETE FROM categories WHERE id = ?', [id])
  saveDb()
}

function assignCategory(itemId: number, categoryId: number): void {
  db.run(
    'INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?, ?)',
    [itemId, categoryId],
  )
  saveDb()
}

function removeCategory(itemId: number, categoryId: number): void {
  db.run(
    'DELETE FROM item_categories WHERE item_id = ? AND category_id = ?',
    [itemId, categoryId],
  )
  saveDb()
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
    syncEnabled: map.syncEnabled === 'true',
    theme: (map.theme || 'dark') as 'light' | 'dark',
    exclusionApps: JSON.parse(map.exclusionApps || '[]'),
    exclusionPatterns: JSON.parse(map.exclusionPatterns || '[]'),
  }
}

function updateSettings(settings: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(settings)) {
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, strValue],
    )
  }
  saveDb()
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
  updateSettings: (settings: Record<string, unknown>) => void
  getStats: () => { totalItems: number; favoriteItems: number; dbSize: number }
  getSensitiveItems: () => import('./sensitiveItems').SensitiveItem[]
  addSensitiveItem: (content: string, dataType: string) => number
  close: () => void
}

export function createWorker(): WorkerBridge {
  initDatabase()

  return {
    storeItem: queueItem,
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
    close: () => { saveDb(); db.close() },
  }
}
