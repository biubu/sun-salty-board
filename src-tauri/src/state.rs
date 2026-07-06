use std::sync::Mutex;
use tauri::{AppHandle, Manager, path::BaseDirectory};
use crate::database::{Database, ClipboardItem};

pub struct AppState {
    pub db: Mutex<Database>,
    pub undo_items: Mutex<Vec<ClipboardItem>>,
    pub db_path: String,
    pub previous_app_bundle_id: Mutex<Option<String>>,
    pub previous_app_pid: Mutex<Option<i32>>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app.path().resolve("", BaseDirectory::AppData)?;
        let db_path = app_dir.join("sunsaltyboard.db");
        std::fs::create_dir_all(&app_dir)?;
        let db = Database::open(db_path.to_str().unwrap())?;
        Ok(Self {
            db: Mutex::new(db),
            undo_items: Mutex::new(Vec::with_capacity(8)),
            db_path: db_path.to_string_lossy().into_owned(),
            previous_app_bundle_id: Mutex::new(None),
            previous_app_pid: Mutex::new(None),
        })
    }
}