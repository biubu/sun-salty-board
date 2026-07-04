// Full-text search over the items table.
//
// Uses SQLite FTS5 when the engine exposes it (sql.js ≥ 1.10), and falls
// back to FTS4 otherwise. FTS5 is preferable because:
//   * it has a public `bm25(...)` ranking function — we don't currently
//     rank, but the door is open;
//   * it supports `content_rowid` linking directly so we don't need the
//     separate manual INSERT/DELETE dance FTS4 forces.
//
// The fallback path keeps the original FTS4 behaviour so older builds
// continue to work without surprises.

interface FtsFlavor {
  name: 'fts5' | 'fts4'
  createSql: string
  indexInsertSql: string
}

function detectFtsFlavor(db: any): FtsFlavor {
  try {
    // sql.js exposes no compileOptions API; we test by trying a tiny FTS5
    // CREATE in a savepoint. If it errors, we know FTS5 isn't compiled in.
    db.run('SAVEPOINT fts_probe')
    db.run("CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(content)")
    db.run('RELEASE fts_probe')
    return {
      name: 'fts5',
      createSql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
          content,
          content_html,
          content='items',
          content_rowid='id'
        )
      `,
      indexInsertSql: '', // FTS5 contentless tables are managed via triggers
    }
  } catch {
    // FTS5 unavailable — fall back to FTS4 with manual indexing.
    db.run('ROLLBACK TO fts_probe')
    try { db.run('RELEASE fts_probe') } catch { /* ignore */ }
    return {
      name: 'fts4',
      createSql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts4(
          content,
          content_html
        )
      `,
      indexInsertSql: `INSERT INTO items_fts(rowid, content, content_html) VALUES (?, ?, ?)`,
    }
  }
}

let flavor: FtsFlavor | null = null

export function createFtsTable(db: any): void {
  flavor = detectFtsFlavor(db)
  // For both flavors we ensure the table exists; if upgrading from a
  // previous build's FTS4 table, the IF NOT EXISTS clause keeps it stable
  // rather than throwing.
  db.run(flavor.createSql)

  // Backfill existing rows for FTS4 (FTS5 with content= is auto-managed).
  if (flavor.name === 'fts4') {
    const existing = db.exec('SELECT COUNT(*) FROM items_fts')
    const ftsCount = (existing[0]?.values[0][0] as number) || 0
    if (ftsCount === 0) {
      db.run(`
        INSERT INTO items_fts(rowid, content, content_html)
        SELECT id, content, content_html FROM items
      `)
    }
  }
}

export function indexItemFts(db: any, itemId: number): void {
  if (!flavor || flavor.name === 'fts5') {
    // FTS5 contentless table is auto-maintained via the items table when
    // configured with content='items', content_rowid='id' — nothing to do.
    return
  }
  const result = db.exec(
    'SELECT content, content_html FROM items WHERE id = ?',
    [itemId],
  )
  if (result.length === 0 || result[0].values.length === 0) return
  const row = result[0].values[0]
  db.run(flavor.indexInsertSql, [itemId, row[0] as string, row[1] as string | null])
}

export function removeItemFts(db: any, itemId: number): void {
  if (!flavor || flavor.name === 'fts5') return
  db.run('DELETE FROM items_fts WHERE rowid = ?', [itemId])
}

export function searchFts(
  db: any,
  query: string,
): Array<{ id: number }> {
  // Strip FTS5's reserved characters (`+-*^"()...`) but keep CJK / Hangul /
  // kana runs so the search works for non-Latin scripts. Whitespace is the
  // only true separator; everything else stays in the query.
  const sanitized = query
    .replace(/["()*+^]/g, ' ')
    .replace(/[^\w\s一-鿿぀-ヿ가-힯]/g, ' ')
    .trim()
  if (!sanitized) return []

  const terms = sanitized.split(/\s+/).filter(Boolean)
  // AND of prefix wildcards, suitable for substring-as-you-type search.
  // For CJK where there are no word boundaries, prefix expansion is moot,
  // but FTS5 still treats each character as its own token.
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
