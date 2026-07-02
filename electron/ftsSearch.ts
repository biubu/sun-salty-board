export function createFtsTable(db: any): void {
  const ftsExists = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'",
  )
  if (ftsExists.length === 0) {
    db.run(`
      CREATE VIRTUAL TABLE items_fts USING fts4(
        content,
        content_html
      )
    `)
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
): Array<{ id: number }> {
  const sanitized = query.replace(/[^\w\s\u4e00-\u9fff-]/g, ' ').trim()
  if (!sanitized) return []

  const terms = sanitized.split(/\s+/).filter(Boolean)
  const ftsQuery = terms.map(t => `"${t}"*`).join(' AND ')

  const result = db.exec(
    `SELECT rowid FROM items_fts WHERE items_fts MATCH ? LIMIT 200`,
    [ftsQuery],
  )
  if (result.length === 0) return []
  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
  }))
}
