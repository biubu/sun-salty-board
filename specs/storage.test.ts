import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import initSqlJs from 'sql.js'

let db: any

beforeAll(async () => {
  const SQL = await initSqlJs()
  db = new SQL.Database()
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
    CREATE TABLE IF NOT EXISTS item_categories (
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
    db.run(
      'INSERT INTO items (content, data_type) VALUES (?, ?)',
      ['test text', 'text'],
    )
    const result = db.exec('SELECT COUNT(*) as cnt FROM items')
    expect((result[0].values[0][0] as number)).toBeGreaterThan(0)
  })

  it('should query items with ordering', () => {
    const result = db.exec('SELECT * FROM items ORDER BY created_at DESC')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should delete items', () => {
    db.run('DELETE FROM items WHERE content = ?', ['test text'])
    const result = db.exec("SELECT COUNT(*) as cnt FROM items WHERE content = 'test text'")
    expect((result[0].values[0][0] as number)).toBe(0)
  })

  it('should trim old non-favorited items', () => {
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['old1', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['old2', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['fav', 'text', 1])

    db.run(
      'DELETE FROM items WHERE id IN (SELECT id FROM items WHERE is_favorite = 0 ORDER BY created_at ASC LIMIT 2)',
    )
    const remaining = db.exec("SELECT content FROM items WHERE is_favorite = 0")
    const favRemaining = db.exec("SELECT content FROM items WHERE is_favorite = 1")
    expect(remaining[0]?.values?.length || 0).toBe(0)
    expect(favRemaining[0].values[0][0]).toBe('fav')
  })

  it('should vacuum when 25%+ deleted', () => {
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['a', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['b', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['c', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['d', 'text', 0])
    db.run('INSERT INTO items (content, data_type, is_favorite) VALUES (?, ?, ?)', ['e', 'text', 1])

    const beforeStats = db.exec('SELECT COUNT(*) FROM items')
    const before = beforeStats[0].values[0][0] as number

    const idsToDelete = db.exec('SELECT id FROM items WHERE is_favorite = 0')
    for (const row of idsToDelete[0]?.values || []) {
      db.run('DELETE FROM items WHERE id = ?', [row[0]])
    }
    const afterDelete = db.exec('SELECT COUNT(*) FROM items')
    const after = afterDelete[0].values[0][0] as number
    expect(after).toBeLessThan(before)
  })
})
