use arboard::Clipboard;
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use crate::database::ClipboardItem;
use crate::state::AppState;

struct ClipboardState {
    last_fingerprint: String,
    last_capture_time: Instant,
    exclusion_rules: Vec<(String, String)>,
    sensitive_mode: bool,
}

impl ClipboardState {
    fn new() -> Self {
        Self {
            last_fingerprint: String::new(),
            last_capture_time: Instant::now(),
            exclusion_rules: Vec::new(),
            sensitive_mode: false,
        }
    }
}

fn compute_fingerprint(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

struct SensitiveStore {
    items: HashMap<i64, Instant>,
    max_items: usize,
}

impl SensitiveStore {
    fn new() -> Self {
        Self { items: HashMap::new(), max_items: 1000 }
    }
}

struct UndoManager {
    entries: Vec<(ClipboardItem, Instant)>,
    max_entries: usize,
    ttl: Duration,
}

impl UndoManager {
    fn new() -> Self {
        Self { entries: Vec::new(), max_entries: 8, ttl: Duration::from_secs(5) }
    }

    fn push(&mut self, item: ClipboardItem) {
        self.entries.push((item, Instant::now()));
        if self.entries.len() > self.max_entries {
            self.entries.remove(0);
        }
    }

    fn pop(&mut self) -> Option<ClipboardItem> {
        while let Some(entry) = self.entries.last() {
            if entry.1.elapsed() > self.ttl {
                self.entries.pop();
            } else {
                return self.entries.pop().map(|e| e.0);
            }
        }
        None
    }
}

pub fn start_monitoring(app: AppHandle) {
    let mut clip_state = ClipboardState::new();
    let dedup_window = Duration::from_millis(100);

    loop {
        std::thread::sleep(Duration::from_millis(500));

        if let Ok(mut clipboard) = Clipboard::new() {
            let (content, item_type, rich_text, file_paths) = if let Ok(text) = clipboard.get_text() {
                (Some(text.clone()), 0, None, None)
            } else if let Ok(_image) = clipboard.get_image() {
                (None, 2, None, None)
            } else {
                continue;
            };

            let content_str = content.as_deref().unwrap_or("");
            let fingerprint = if content_str.is_empty() {
                String::new()
            } else {
                compute_fingerprint(content_str)
            };

            if fingerprint.is_empty() || fingerprint == clip_state.last_fingerprint {
                continue;
            }

            if clip_state.last_capture_time.elapsed() < dedup_window {
                continue;
            }

            // Check exclusion rules
            let should_exclude = clip_state.exclusion_rules.iter().any(|(_, pattern)| {
                regex_lite::Regex::new(pattern).map_or(false, |re| re.is_match(content_str))
            });
            if should_exclude {
                continue;
            }

            clip_state.last_fingerprint = fingerprint.clone();
            clip_state.last_capture_time = Instant::now();

            let item = ClipboardItem {
                id: 0,
                item_type,
                content,
                rich_text,
                file_paths,
                fingerprint,
                sensitive: clip_state.sensitive_mode,
                favorite: false,
                created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                categories: None,
            };

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(db) = state.db.lock() {
                    let _ = db.enqueue_item(item.clone());
                }
            }

            let _ = app.emit("clipboard-changed", &item);
        }
    }
}
