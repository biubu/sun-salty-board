import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'

let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE items (
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
    CREATE TABLE item_categories (
      item_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (item_id, category_id)
    );
  `)
})

afterAll(() => {
  db.close()
})

describe('Storage Layer', () => {
  it('should insert items', () => {
    db.prepare('INSERT INTO items (content, data_type) VALUES (?, ?)').run('test text', 'text')
    const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM items').get() as { cnt: number }
    expect(cnt).toBeGreaterThan(0)
  })

  it('should query items with ordering', () => {
    const rows = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('should delete items', () => {
    db.prepare('DELETE FROM items WHERE content = ?').run('test text')
    const { cnt } = db.prepare("SELECT COUNT(*) AS cnt FROM items WHERE content = 'test text'").get() as { cnt: number }
    expect(cnt).toBe(0)
  })

  it('should trim old non-favorited items', () => {
    db.prepare('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)').run('old1', 'text', 0)
    db.prepare('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)').run('old2', 'text', 0)
    db.prepare('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)').run('fav', 'text', 1)

    db.prepare(
      'DELETE FROM items WHERE id IN (SELECT id FROM items WHERE is_favorite = 0 ORDER BY created_at ASC LIMIT 2)',
    ).run()
    const remaining = db.prepare("SELECT content FROM items WHERE is_favorite = 0").all() as Array<{ content: string }>
    const favRemaining = db.prepare("SELECT content FROM items WHERE is_favorite = 1").all() as Array<{ content: string }>
    expect(remaining.length).toBe(0)
    expect(favRemaining[0].content).toBe('fav')
  })

  it('keeps favorites untouched by bulk delete', () => {
    db.prepare('DELETE FROM items WHERE is_favorite = 0').run()
    db.prepare('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)').run('plain-bulk', 'text', 0)
    db.prepare('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)').run('pinned-bulk', 'text', 1)

    db.prepare('DELETE FROM items WHERE is_favorite = 0').run()
    const favRemaining = db.prepare("SELECT content FROM items WHERE is_favorite = 1 AND content = 'pinned-bulk'").all() as Array<{ content: string }>
    expect(favRemaining.length).toBe(1)
    expect(favRemaining[0].content).toBe('pinned-bulk')
  })
})
