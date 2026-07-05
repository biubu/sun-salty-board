use serde::{Deserialize, Serialize};
use rusqlite::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ItemType {
    Text = 0,
    RichText = 1,
    Image = 2,
    File = 3,
}

impl ItemType {
    pub fn from_i32(n: i32) -> Self {
        match n {
            0 => ItemType::Text,
            1 => ItemType::RichText,
            2 => ItemType::Image,
            3 => ItemType::File,
            _ => ItemType::Text,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: i64,
    #[serde(rename = "type")]
    pub item_type: i32,
    pub content: Option<String>,
    pub rich_text: Option<String>,
    pub file_paths: Option<String>,
    pub fingerprint: String,
    pub sensitive: bool,
    pub favorite: bool,
    pub created_at: String,
    pub categories: Option<Vec<i64>>,
}

impl ClipboardItem {
    pub fn type_str(&self) -> i32 {
        self.item_type
    }

    pub fn from_row(row: &Row) -> Self {
        Self {
            id: row.get(0).unwrap_or(0),
            item_type: row.get(1).unwrap_or(0),
            content: row.get(2).ok(),
            rich_text: row.get(3).ok(),
            file_paths: row.get(4).ok(),
            fingerprint: row.get(5).unwrap_or_default(),
            sensitive: row.get::<_, i32>(6).unwrap_or(0) != 0,
            favorite: row.get::<_, i32>(7).unwrap_or(0) != 0,
            created_at: row.get(8).unwrap_or_default(),
            categories: None,
        }
    }

    pub fn to_csv_line(&self) -> String {
        format!(
            "{},{},{:?},{:?},{},{},{},{}",
            self.id, self.item_type, self.content, self.rich_text,
            self.fingerprint, self.sensitive, self.favorite, self.created_at
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

pub struct UndoEntry {
    pub item: ClipboardItem,
    pub expires_at: std::time::Instant,
}
