mod schema;
mod models;
mod search;

use rusqlite::{Connection, params};
use std::sync::Mutex;

pub use self::models::{ClipboardItem, Category, ItemType};
pub use self::search::SearchQuery;

pub struct Database {
    conn: Connection,
    write_queue: Mutex<Vec<ClipboardItem>>,
    last_flush: Mutex<std::time::Instant>,
}

const FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
const FLUSH_BATCH_SIZE: usize = 50;

// Column projection used for every read query below. The order MUST match
// the positional indices consumed by `ClipboardItem::from_row`:
//  0 id, 1 type, 2 content, 3 rich_text, 4 file_paths,
//  5 image_data, 6 image_mime, 7 fingerprint,
//  8 sensitive, 9 favorite, 10 created_at
const SELECT_COLUMNS: &str =
    "id, type, content, rich_text, file_paths, image_data, image_mime, \
     fingerprint, sensitive, favorite, created_at";

const INSERT_COLUMNS: &str =
    "type, content, rich_text, file_paths, image_data, image_mime, fingerprint, sensitive, favorite, created_at";

impl Database {
    pub fn open(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        schema::initialize(&conn)?;
        schema::migrate_add_image_columns(&conn)?;
        schema::migrate_fts4_to_fts5(&conn)?;
        Ok(Self {
            conn,
            write_queue: Mutex::new(Vec::new()),
            last_flush: Mutex::new(std::time::Instant::now()),
        })
    }

    pub fn insert_item(&self, item: &ClipboardItem) -> Result<i64, Box<dyn std::error::Error>> {
        self.conn.execute(
            &format!(
                "INSERT INTO items ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                INSERT_COLUMNS
            ),
            params![
                item.type_str(),
                item.content,
                item.rich_text,
                item.file_paths.as_deref(),
                item.image_data.as_deref(),
                item.image_mime,
                item.fingerprint,
                item.sensitive,
                item.favorite,
                item.created_at,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        if let Some(ref cats) = item.categories {
            for cat_id in cats {
                self.conn.execute(
                    "INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?1, ?2)",
                    params![id, cat_id],
                )?;
            }
        }
        Ok(id)
    }

    pub fn enqueue_item(&self, item: ClipboardItem) -> Result<(), Box<dyn std::error::Error>> {
        let mut queue = self.write_queue.lock().unwrap();
        queue.push(item);
        if queue.len() >= FLUSH_BATCH_SIZE {
            let batch = std::mem::take(&mut *queue);
            drop(queue);
            self.flush_batch(&batch)?;
        } else {
            let last = *self.last_flush.lock().unwrap();
            if last.elapsed() >= FLUSH_INTERVAL {
                drop(queue);
                self.flush()?;
            }
        }
        Ok(())
    }

    pub fn flush(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut queue = self.write_queue.lock().unwrap();
        if queue.is_empty() {
            return Ok(());
        }
        let batch = std::mem::take(&mut *queue);
        *self.last_flush.lock().unwrap() = std::time::Instant::now();
        drop(queue);
        self.flush_batch(&batch)
    }

    fn flush_batch(&self, batch: &[ClipboardItem]) -> Result<(), Box<dyn std::error::Error>> {
        let tx = self.conn.unchecked_transaction()?;
        for item in batch {
            tx.execute(
                &format!("INSERT INTO items ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)", INSERT_COLUMNS),
                params![
                    item.type_str(),
                    item.content,
                    item.rich_text,
                    item.file_paths.as_deref(),
                    item.image_data.as_deref(),
                    item.image_mime,
                    item.fingerprint,
                    item.sensitive,
                    item.favorite,
                    item.created_at,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_items(&self, limit: usize, offset: usize) -> Result<Vec<ClipboardItem>, Box<dyn std::error::Error>> {
        let sql = format!(
            "SELECT {} FROM items ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
            SELECT_COLUMNS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit as i64, offset as i64], |row| {
            Ok(ClipboardItem::from_row(row))
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn search_items(&self, query: &str, limit: usize) -> Result<Vec<ClipboardItem>, Box<dyn std::error::Error>> {
        let sanitized = SearchQuery::sanitize(query);
        // Qualify every column with `i.` because `items_fts` also exposes a
        // `content` column (the FTS mirror of `items.content`). Without the
        // alias SQLite refuses the query as ambiguous.
        let sql = format!(
            "SELECT {prefixed} FROM items i \
             INNER JOIN items_fts ON i.id = items_fts.rowid \
             WHERE items_fts MATCH ?1 \
             ORDER BY rank LIMIT ?2",
            prefixed = SELECT_COLUMNS
                .split(',')
                .map(|c| format!("i.{}", c.trim()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![sanitized, limit as i64], |row| {
            Ok(ClipboardItem::from_row(row))
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn delete_item(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
        // The `items_ad` trigger would normally clean up the FTS index, but
        // bulk DELETE statements bypass triggers in SQLite, so delete
        // explicitly. `item_categories` is removed via FK cascade.
        self.conn.execute("DELETE FROM items_fts WHERE rowid = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_history(&self, preserve_favorites: bool) -> Result<(), Box<dyn std::error::Error>> {
        // The `items_ad` trigger handles FTS cleanup for `DELETE FROM items`,
        // and `ON DELETE CASCADE` cleans up `item_categories`. Running
        // everything in a single transaction keeps the FTS index consistent
        // even if a row fails the trigger mid-batch.
        let tx = self.conn.unchecked_transaction()?;
        let sql = if preserve_favorites {
            "DELETE FROM items WHERE favorite = 0"
        } else {
            "DELETE FROM items"
        };
        tx.execute(sql, [])?;
        tx.commit()?;
        // VACUUM is intentionally NOT run here — it rewrites the entire
        // database file, can starve the UI thread, and offers no behavioural
        // benefit since WAL+autovacuum reclaim space on the next checkpoint.
        Ok(())
    }

    pub fn toggle_favorite(&self, id: i64) -> Result<bool, Box<dyn std::error::Error>> {
        self.conn.execute(
            "UPDATE items SET favorite = CASE WHEN favorite = 0 THEN 1 ELSE 0 END WHERE id = ?1",
            params![id],
        )?;
        let val: bool = self.conn.query_row(
            "SELECT favorite FROM items WHERE id = ?1", params![id],
            |row| row.get(0),
        )?;
        Ok(val)
    }

    pub fn get_favorites(&self) -> Result<Vec<ClipboardItem>, Box<dyn std::error::Error>> {
        let sql = format!(
            "SELECT {} FROM items WHERE favorite = 1 ORDER BY created_at DESC",
            SELECT_COLUMNS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| Ok(ClipboardItem::from_row(row)))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn get_stats(&self) -> Result<(i64, i64), Box<dyn std::error::Error>> {
        let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))?;
        let today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM items WHERE date(created_at) = date('now')",
            [],
            |row| row.get(0),
        )?;
        Ok((total, today))
    }

    pub fn get_favorites_count(&self) -> Result<i64, Box<dyn std::error::Error>> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM items WHERE favorite = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn create_category(&self, name: &str, color: Option<&str>) -> Result<i64, Box<dyn std::error::Error>> {
        self.conn.execute(
            "INSERT INTO categories (name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn rename_category(&self, id: i64, name: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute(
            "UPDATE categories SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn delete_category(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute("DELETE FROM item_categories WHERE category_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_categories(&self) -> Result<Vec<Category>, Box<dyn std::error::Error>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, created_at FROM categories ORDER BY name"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        let mut cats = Vec::new();
        for row in rows {
            cats.push(row?);
        }
        Ok(cats)
    }

    pub fn assign_category(&self, item_id: i64, category_id: i64) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute(
            "INSERT OR IGNORE INTO item_categories (item_id, category_id) VALUES (?1, ?2)",
            params![item_id, category_id],
        )?;
        Ok(())
    }

    pub fn remove_category(&self, item_id: i64, category_id: i64) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute(
            "DELETE FROM item_categories WHERE item_id = ?1 AND category_id = ?2",
            params![item_id, category_id],
        )?;
        Ok(())
    }

    pub fn expire_old_items(&self, max_days: i64) -> Result<usize, Box<dyn std::error::Error>> {
        let count = self.conn.execute(
            "DELETE FROM items WHERE favorite = 0 AND created_at < datetime('now', ?1)",
            params![format!("-{} days", max_days)],
        )?;
        // Bulk DELETE bypasses the FTS trigger, so wipe stale rows manually.
        self.conn.execute(
            "DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)",
            [],
        )?;
        Ok(count)
    }

    pub fn get_item_by_id(&self, id: i64) -> Result<Option<ClipboardItem>, Box<dyn std::error::Error>> {
        let sql = format!(
            "SELECT {} FROM items WHERE id = ?1",
            SELECT_COLUMNS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut rows = stmt.query_map(params![id], |row| Ok(ClipboardItem::from_row(row)))?;
        match rows.next() {
            Some(Ok(item)) => Ok(Some(item)),
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Database {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = format!("/tmp/sunsaltyboard_test_{}_{}.db", std::process::id(), n);
        let _ = std::fs::remove_file(&path);
        Database::open(&path).expect(&format!("Failed to open test db at {}", path))
    }

    fn make_item(content: Option<&str>, item_type: i32, favorite: bool, fingerprint: &str) -> ClipboardItem {
        ClipboardItem {
            id: 0,
            item_type,
            content: content.map(|s| s.to_string()),
            rich_text: None,
            file_paths: None,
            image_data: None,
            image_mime: None,
            fingerprint: fingerprint.to_string(),
            sensitive: false,
            favorite,
            created_at: "2024-01-01 12:00:00".into(),
            categories: None,
        }
    }

    #[test]
    fn test_insert_and_get_items() {
        let db = setup_db();
        let item = make_item(Some("hello world"), 0, false, "abc123");
        let id = db.insert_item(&item).expect("insert failed");
        assert!(id > 0);
        let items = db.get_items(10, 0).expect("get_items failed");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content.as_deref(), Some("hello world"));
    }

    #[test]
    fn test_delete_item() {
        let db = setup_db();
        let item = make_item(Some("delete me"), 0, false, "del");
        let id = db.insert_item(&item).unwrap();
        db.delete_item(id).unwrap();
        assert_eq!(db.get_items(10, 0).unwrap().len(), 0);
        // FTS index should also be clean so search does not return orphans.
        assert_eq!(db.search_items("delete", 10).unwrap().len(), 0);
    }

    #[test]
    fn test_clear_history() {
        let db = setup_db();
        for i in 0..3 {
            let item = make_item(Some(&format!("item {}", i)), 0, i == 0, &format!("fp{}", i));
            db.insert_item(&item).unwrap();
        }
        db.clear_history(true).unwrap();
        assert_eq!(db.get_items(10, 0).unwrap().len(), 1);
        // FTS index should be reaped alongside the rows so a post-clear
        // search for the deleted text does not return phantom hits.
        assert_eq!(db.search_items("item", 10).unwrap().len(), 1);
        db.clear_history(false).unwrap();
        assert_eq!(db.get_items(10, 0).unwrap().len(), 0);
        assert_eq!(db.search_items("item", 10).unwrap().len(), 0);
    }

    #[test]
    fn test_toggle_favorite() {
        let db = setup_db();
        let item = make_item(Some("fav test"), 0, false, "fav");
        let id = db.insert_item(&item).unwrap();
        let new_val = db.toggle_favorite(id).unwrap();
        assert!(new_val);
        let new_val2 = db.toggle_favorite(id).unwrap();
        assert!(!new_val2);
    }

    #[test]
    fn test_favorites() {
        let db = setup_db();
        for i in 0..3 {
            let item = make_item(Some(&format!("item {}", i)), 0, i == 1, &format!("fav-fp-{}", i));
            db.insert_item(&item).unwrap();
        }
        let favs = db.get_favorites().unwrap();
        assert_eq!(favs.len(), 1);
    }

    #[test]
    fn test_search() {
        let db = setup_db();
        let item = make_item(Some("unique searchable text"), 0, false, "src");
        db.insert_item(&item).unwrap();
        let results = db.search_items("searchable", 10).unwrap();
        assert_eq!(results.len(), 1);
        let no_results = db.search_items("nonexistent", 10).unwrap();
        assert_eq!(no_results.len(), 0);
    }

    #[test]
    fn test_categories_crud() {
        let db = setup_db();
        let id = db.create_category("test-cat", Some("#ff0000")).unwrap();
        assert!(id > 0);
        let cats = db.list_categories().unwrap();
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].name, "test-cat");

        db.rename_category(id, "renamed-cat").unwrap();
        let cats = db.list_categories().unwrap();
        assert_eq!(cats[0].name, "renamed-cat");

        db.delete_category(id).unwrap();
        assert_eq!(db.list_categories().unwrap().len(), 0);
    }

    #[test]
    fn test_write_queue() {
        let db = setup_db();
        for i in 0..3 {
            let item = make_item(Some(&format!("qitem {}", i)), 0, false, &format!("qfp{}", i));
            db.enqueue_item(item).unwrap();
        }
        db.flush().unwrap();
        assert_eq!(db.get_items(10, 0).unwrap().len(), 3);
    }

    #[test]
    fn test_expire_old_items() {
        let db = setup_db();
        let old = make_item(Some("old item"), 0, false, "old");
        let mut old_with_old_date = old.clone();
        old_with_old_date.created_at = "2020-01-01 12:00:00".into();
        db.insert_item(&old_with_old_date).unwrap();
        let new_item = make_item(Some("new item"), 0, true, "new");
        db.insert_item(&new_item).unwrap();
        let expired = db.expire_old_items(365).unwrap();
        assert!(expired > 0);
        assert_eq!(db.get_items(10, 0).unwrap().len(), 1);
    }

    #[test]
    fn test_get_item_by_id() {
        let db = setup_db();
        let item = make_item(Some("by id"), 0, false, "id");
        let id = db.insert_item(&item).unwrap();
        let found = db.get_item_by_id(id).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().content.as_deref(), Some("by id"));
        let not_found = db.get_item_by_id(99999).unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_image_item_roundtrip() {
        let db = setup_db();
        let mut item = make_item(None, ItemType::Image as i32, false, "img-fp");
        item.image_data = Some(vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        item.image_mime = Some("image/png".into());
        let id = db.insert_item(&item).unwrap();

        let fetched = db.get_item_by_id(id).unwrap().unwrap();
        assert_eq!(fetched.item_type, ItemType::Image as i32);
        assert_eq!(
            fetched.image_data.as_deref(),
            Some(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A][..])
        );
        assert_eq!(fetched.image_mime.as_deref(), Some("image/png"));
    }

    #[test]
    fn test_file_item_roundtrip() {
        let db = setup_db();
        let mut item = make_item(None, ItemType::Files as i32, false, "file-fp");
        item.file_paths = Some("/Users/a/file1.txt\n/Users/a/file2.txt".into());
        let id = db.insert_item(&item).unwrap();

        let fetched = db.get_item_by_id(id).unwrap().unwrap();
        assert_eq!(fetched.item_type, ItemType::Files as i32);
        assert_eq!(
            fetched.file_paths.as_deref(),
            Some("/Users/a/file1.txt\n/Users/a/file2.txt")
        );
    }
}