// Regression for the FTS4→FTS5 schema-drift crash that broke packaged
// toggleFavorite in v2.0.0.
//
// v1.x (sql.js era) shipped a FTS4 `items_fts(content)` table; v2.x
// (`better-sqlite3`) declares an FTS5 `items_fts(content, content_html,
// content='items', content_rowid='id')` table plus three AFTER triggers
// that assume FTS5 syntax. The trigger references passed `IF NOT EXISTS`
// silently — the legacy FTS4 table was left intact — and the very first
// UPDATE on items hit the AU trigger, which uses
// `INSERT INTO fts(fts, rowid, ...) VALUES ('delete', ...)` (FTS5-only)
// against a single-column FTS4 backing table, returning "SQL logic error"
// and crashing the IPC handler.
//
// Fix shape: ensureSchema ALWAYS drops items_fts + the three triggers,
// recreates them as FTS5, and backfills from items so existing history
// continues to be searchable. This test verifies all three: schema
// reconstruction, UPDATE no longer throws, and backfilled content is
// retrievable via MATCH.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

let db: ReturnType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')

  // v1.x items table (no image_mime column; that's a v1.2.x migration).
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
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
    )
  `)
})

afterEach(() => {
  db.close()
})

function replicateV2EnsureSchema(database: ReturnType<typeof Database>): void {
  // EXACT copy of the logic in electron/worker.ts ensureSchema (the FTS
  // block). If this drifts, the test will silently start to mismatch the
  // code path it's meant to guard.
  database.exec(`DROP TABLE IF EXISTS items_fts`)
  database.exec(`DROP TRIGGER IF EXISTS items_fts_ai`)
  database.exec(`DROP TRIGGER IF EXISTS items_fts_au`)
  database.exec(`DROP TRIGGER IF EXISTS items_fts_ad`)
  database.exec(`
    CREATE VIRTUAL TABLE items_fts USING fts5(
      content, content_html, content='items', content_rowid='id'
    )
  `)
  database.exec(`
    CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, content, content_html)
      VALUES (new.id, new.content, new.content_html);
    END
  `)
  database.exec(`
    CREATE TRIGGER items_fts_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, content_html)
      VALUES ('delete', old.id, old.content, old.content_html);
      INSERT INTO items_fts(rowid, content, content_html)
      VALUES (new.id, new.content, new.content_html);
    END
  `)
  database.exec(`
    CREATE TRIGGER items_fts_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, content_html)
      VALUES ('delete', old.id, old.content, old.content_html);
    END
  `)
  database.exec(`
    INSERT INTO items_fts(rowid, content, content_html)
    SELECT id, content, IFNULL(content_html, '') FROM items
  `)
}

describe('FTS schema migration (v1.x FTS4 → v2.x FTS5)', () => {
  it('drops legacy FTS4 items_fts and rebuilds as FTS5 with triggers', () => {
    // Pre-populate a v1.x-style FTS4 table — single column.
    db.exec(`CREATE VIRTUAL TABLE items_fts USING fts4(content)`)
    db.prepare(`INSERT INTO items (content) VALUES ('alpha')`).run()
    db.prepare(`INSERT INTO items_fts(docid, content) VALUES (1, 'alpha')`).run()

    replicateV2EnsureSchema(db)

    // The post-migration table is FTS5, with the expected column shape.
    const cols = db.pragma("table_info('items_fts')") as Array<{ name: string }>
    expect(cols.map((c) => c.name).sort()).toEqual(['content', 'content_html'])
  })

  it('UPDATE on items no longer throws after schema rebuild (toggleFavorite path)', () => {
    db.exec(`CREATE VIRTUAL TABLE items_fts USING fts4(content)`)
    db.prepare(`INSERT INTO items (content) VALUES ('alpha')`).run()
    db.prepare(`INSERT INTO items_fts(docid, content) VALUES (1, 'alpha')`).run()

    replicateV2EnsureSchema(db)

    // This is the SQL toggleFavorite runs: a plain UPDATE. Pre-fix, it
    // crashed inside the AU trigger with "SQL logic error".
    expect(() =>
      db.prepare(
        `UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?`,
      ).run(1),
    ).not.toThrow()
  })

  it('backfills the FTS index from items so search still hits old rows', () => {
    db.exec(`CREATE VIRTUAL TABLE items_fts USING fts4(content)`)
    const insertItem = db.prepare(`INSERT INTO items (content) VALUES (?)`)
    const insertFts4 = db.prepare(`INSERT INTO items_fts(docid, content) VALUES (?, ?)`)
    for (const word of ['alpha', 'beta', 'gamma']) {
      const info = insertItem.run(word)
      insertFts4.run(Number(info.lastInsertRowid), word)
    }

    replicateV2EnsureSchema(db)

    // After migration, every row is reachable via its own term.
    const matches = db.prepare(
      `SELECT rowid FROM items_fts WHERE items_fts MATCH ? ORDER BY rowid`,
    )
    expect((matches.all('alpha') as Array<{ rowid: number }>).map((h) => h.rowid)).toEqual([1])
    expect((matches.all('beta') as Array<{ rowid: number }>).map((h) => h.rowid)).toEqual([2])
    expect((matches.all('gamma') as Array<{ rowid: number }>).map((h) => h.rowid)).toEqual([3])
  })

  it('triggers stay correct after a follow-up insert (no regressions)', () => {
    db.exec(`CREATE VIRTUAL TABLE items_fts USING fts4(content)`)
    replicateV2EnsureSchema(db)

    db.prepare(`INSERT INTO items (content) VALUES ('newly added')`).run()
    db.prepare(`INSERT INTO items (content) VALUES ('another row')`).run()

    const hits = db.prepare(
      `SELECT COUNT(*) AS cnt FROM items_fts WHERE items_fts MATCH ?`,
    ).all('newly') as Array<{ cnt: number }>
    expect((hits[0] as unknown as { cnt: number }).cnt).toBe(1)
  })
})
