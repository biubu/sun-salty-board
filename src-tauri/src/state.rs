use std::sync::Mutex;
use tauri::{AppHandle, Manager, path::BaseDirectory};
use crate::database::Database;

pub struct AppState {
    pub db: Mutex<Database>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app.path().resolve("", BaseDirectory::AppData)?;
        let db_path = app_dir.join("sunsaltyboard.db");
        std::fs::create_dir_all(&app_dir)?;
        let db = Database::open(db_path.to_str().unwrap())?;
        Ok(Self { db: Mutex::new(db) })
    }
}
