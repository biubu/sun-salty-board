use arboard::Clipboard;
use sha2::{Sha256, Digest};
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

fn load_exclusion_rules(app: &AppHandle, clip_state: &mut ClipboardState) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(db) = state.db.lock() {
            if let Ok(mut stmt) = db.conn().prepare(
                "SELECT value FROM settings WHERE key = 'exclusionPatterns'"
            ) {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    for row in rows.flatten() {
                        clip_state.exclusion_rules = row
                            .split('\n')
                            .filter(|p| !p.is_empty())
                            .map(|p| (String::new(), p.to_string()))
                            .collect();
                    }
                }
            }
        }
    }
}

pub fn start_monitoring(app: AppHandle) {
    let mut clip_state = ClipboardState::new();
    let dedup_window = Duration::from_millis(100);
    let mut last_exclusion_load = Instant::now();

    loop {
        std::thread::sleep(Duration::from_millis(500));

        if last_exclusion_load.elapsed() > Duration::from_secs(30) {
            load_exclusion_rules(&app, &mut clip_state);
            last_exclusion_load = Instant::now();
        }

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
