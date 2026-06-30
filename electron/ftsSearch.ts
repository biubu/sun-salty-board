export function createFtsTable(db: any): void {
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      content,
      content_html,
      content='items',
      content_rowid='id'
    )
  `)

  const existing = db.exec(
    `SELECT COUNT(*) as cnt FROM items_fts WHERE items_fts MATCH 'a'`,
  )
  const hasContent = existing.length > 0 && (existing[0].values[0][0] as number) > 0
  if (!hasContent) {
    db.run(`
      INSERT INTO items_fts(rowid, content, content_html)
      SELECT id, content, content_html FROM items
    `)
  }
}

export function indexItemFts(db: any, itemId: number): void {
  const result = db.exec(
    'SELECT content, content_html FROM items WHERE id = ?',
    [itemId],
  )
  if (result.length === 0 || result[0].values.length === 0) return
  const row = result[0].values[0]
  db.run(
    `INSERT INTO items_fts(rowid, content, content_html) VALUES (?, ?, ?)`,
    [itemId, row[0] as string, row[1] as string | null],
  )
}

export function removeItemFts(db: any, itemId: number): void {
  db.run('DELETE FROM items_fts WHERE rowid = ?', [itemId])
}

export function searchFts(
  db: any,
  query: string,
): Array<{ id: number; rank: number }> {
  const sanitized = query.replace(/[^\w\s\u4e00-\u9fff-]/g, ' ').trim()
  if (!sanitized) return []

  const result = db.exec(
    `SELECT rowid, rank FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT 200`,
    [`"${sanitized}"*`],
  )
  if (result.length === 0) return []
  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    rank: row[1] as number,
  }))
}
