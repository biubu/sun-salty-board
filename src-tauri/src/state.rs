use std::sync::Mutex;
use tauri::{AppHandle, Manager, path::BaseDirectory};
use crate::database::{Database, ClipboardItem};

pub struct AppState {
    pub db: Mutex<Database>,
    pub undo_items: Mutex<Vec<ClipboardItem>>,
    pub db_path: String,
    pub previous_app_bundle_id: Mutex<Option<String>>,
    pub previous_app_pid: Mutex<Option<i32>>,
    // Fingerprint of the clipboard content we most recently observed (or
    // most recently forced). Owned by the polling thread, but updated by
    // the paste path so a paste doesn't immediately bounce back as a new
    // history entry. See clipboard::start_monitoring for the read side.
    pub last_clipboard_fingerprint: Mutex<String>,
    // The currently-registered global-shortcut string. Kept here (and
    // not in lib.rs) so the `set_hotkey` command can atomically swap
    // the old binding for the new one without racing the polling
    // thread. Initialised to the same default `lib.rs` registers at
    // setup; updated by commands::hotkey::set_hotkey on each change.
    pub current_hotkey: Mutex<String>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app.path().resolve("", BaseDirectory::AppData)?;
        let db_path = app_dir.join("sunsaltyboard.db");
        std::fs::create_dir_all(&app_dir)?;
        let db = Database::open(db_path.to_str().unwrap())?;
        // Seed current_hotkey from the persisted setting if the user
        // already customised it before this launch, otherwise the
        // out-of-the-box default. lib.rs reads this same value when it
        // registers the initial OS-level shortcut.
        let initial_hotkey = db
            .conn()
            .prepare("SELECT value FROM settings WHERE key = 'hotkey'")
            .ok()
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)).ok())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Alt+Shift+V".to_string());
        Ok(Self {
            db: Mutex::new(db),
            undo_items: Mutex::new(Vec::with_capacity(8)),
            db_path: db_path.to_string_lossy().into_owned(),
            previous_app_bundle_id: Mutex::new(None),
            previous_app_pid: Mutex::new(None),
            last_clipboard_fingerprint: Mutex::new(String::new()),
            current_hotkey: Mutex::new(initial_hotkey),
        })
    }
}