use serde::{Deserialize, Serialize};
use rusqlite::{types::ValueRef, Row};

// Stable integer IDs used for the `items.type` column. The mapping must
// match `mapItem` on the frontend:
//   0 = Text, 1 = RichText, 2 = Image, 3 = Files
#[repr(i32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemType {
    Text = 0,
    Richtext = 1,
    Image = 2,
    Files = 3,
}

impl ItemType {
    pub fn as_i32(self) -> i32 {
        self as i32
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
    #[serde(with = "opt_blob_serde")]
    pub image_data: Option<Vec<u8>>,
    pub image_mime: Option<String>,
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

    // Columns are read positionally to avoid an extra `SELECT *` round-trip
    // and to keep the row-mapping free of `serde_rusqlite` indirection.
    pub fn from_row(row: &Row) -> Self {
        let item_type: i32 = row.get::<_, i32>(1).unwrap_or(0);
        // Coerce unknown values from future schema migrations to Text so a
        // stray row never reaches the frontend as an undefined `dataType`.
        let normalized_type = match item_type {
            0..=3 => item_type,
            _ => 0,
        };

        Self {
            id: row.get(0).unwrap_or(0),
            item_type: normalized_type,
            content: row.get(2).ok(),
            rich_text: row.get(3).ok(),
            file_paths: row.get(4).ok(),
            image_data: blob_from_row(row, 5),
            image_mime: row.get(6).ok(),
            fingerprint: row.get(7).unwrap_or_default(),
            sensitive: row.get::<_, i32>(8).unwrap_or(0) != 0,
            favorite: row.get::<_, i32>(9).unwrap_or(0) != 0,
            created_at: row.get(10).unwrap_or_default(),
            categories: None,
        }
    }
}

fn blob_from_row(row: &Row, idx: usize) -> Option<Vec<u8>> {
    match row.get_ref(idx) {
        Ok(ValueRef::Blob(b)) => Some(b.to_vec()),
        _ => None,
    }
}

// Serialise Option<Vec<u8>> as a JSON array of bytes so the payload can ride
// the standard IPC channel. The frontend converts the array back to a
// Uint8Array before constructing the blob URL.
mod opt_blob_serde {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(bytes) => s.serialize_some(bytes.as_slice()),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        Option::<Vec<u8>>::deserialize(d)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
}