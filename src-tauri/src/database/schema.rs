use rusqlite::Connection;

pub fn initialize(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type INTEGER NOT NULL,
            content TEXT,
            rich_text TEXT,
            file_paths TEXT,
            image_data BLOB,
            image_mime TEXT,
            fingerprint TEXT NOT NULL,
            sensitive INTEGER NOT NULL DEFAULT 0,
            favorite INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_items_fingerprint ON items(fingerprint);
        CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(favorite);

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS item_categories (
            item_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            PRIMARY KEY (item_id, category_id),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
            content,
            content=items,
            content_rowid=id,
            tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
            INSERT INTO items_fts(rowid, content) VALUES (new.id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, content) VALUES('delete', old.id, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, content) VALUES('delete', old.id, old.content);
            INSERT INTO items_fts(rowid, content) VALUES (new.id, new.content);
        END;"
    )?;
    Ok(())
}

// Add image columns to existing databases that pre-date this schema.
// New `initialize()` already creates them inline, so this is only a fallback
// for databases created by older versions. Idempotent — the ALTER is skipped
// when the column already exists.
pub fn migrate_add_image_columns(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_image_data: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('items') WHERE name = 'image_data'",
        [],
        |row| row.get(0),
    )?;
    if !has_image_data {
        conn.execute_batch("ALTER TABLE items ADD COLUMN image_data BLOB;")?;
    }
    let has_image_mime: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('items') WHERE name = 'image_mime'",
        [],
        |row| row.get(0),
    )?;
    if !has_image_mime {
        conn.execute_batch("ALTER TABLE items ADD COLUMN image_mime TEXT;")?;
    }
    Ok(())
}

pub fn migrate_fts4_to_fts5(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_fts4: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='items_fts4'",
        [],
        |row| row.get(0),
    )?;
    if !has_fts4 {
        return Ok(());
    }
    conn.execute_batch(
        "DROP TABLE IF EXISTS items_fts5;
        CREATE VIRTUAL TABLE items_fts5 USING fts5(content, tokenize='unicode61 tokenchars');
        INSERT INTO items_fts5(rowid, content) SELECT rowid, content FROM items_fts4;
        DROP TABLE items_fts4;
        ALTER TABLE items_fts5 RENAME TO items_fts;
        DROP TRIGGER IF EXISTS items_fts4_ai;
        DROP TRIGGER IF EXISTS items_fts4_ad;
        DROP TRIGGER IF EXISTS items_fts4_au;"
    )?;
    Ok(())
}