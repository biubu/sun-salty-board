use arboard::Clipboard;
use sha2::{Sha256, Digest};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use crate::database::{ClipboardItem, ItemType};
use crate::state::AppState;

struct ClipboardState {
    last_capture_time: Instant,
    exclusion_rules: Vec<(String, String)>,
    sensitive_mode: bool,
}

impl ClipboardState {
    fn new() -> Self {
        Self {
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

fn compute_fingerprint_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
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

// Probe the OS clipboard for any of the four content types we track. Order
// matters: on macOS, a copy of formatted text typically also exposes a
// plain-text representation, so HTML/text wins over image/file_list to
// avoid losing the rich copy. The returned tuple keeps the captured payload
// ready for ClipboardItem construction.
//
// `image_bytes` is the raw encoded bytes (PNG on macOS/Linux, BMP on
// Windows) and `image_mime` is the matching MIME — both stored verbatim so
// paste can round-trip them without re-encoding.
fn capture_clipboard(
    clipboard: &mut Clipboard,
) -> Option<(ItemType, Option<String>, Option<String>, Option<String>, Option<Vec<u8>>, Option<String>)> {
    // Plain text first — most common case and gives us a fingerprint even
    // when the original copy was richer.
    let text = clipboard.get_text().ok();

    // If we got text, decide whether it is plain or rich. HTML is read
    // through arboard's builder API; if the source app did not provide an
    // HTML representation, fall back to plain text.
    if let Some(t) = text.as_ref() {
        if !t.is_empty() {
            let html = clipboard.get().html().ok();
            if let Some(html_text) = html {
                if !html_text.is_empty() && html_text.as_str() != t.as_str() {
                    return Some((
                        ItemType::Richtext,
                        Some(t.clone()),
                        Some(html_text),
                        None,
                        None,
                        None,
                    ));
                }
            }
            return Some((ItemType::Text, Some(t.clone()), None, None, None, None));
        }
    }

    // No text — try file list. macOS exposes this as NSPasteboardTypeFileURL
    // when Finder or another app copies files.
    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            let joined = paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\n");
            let label = paths
                .iter()
                .map(|p| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| p.to_string_lossy().into_owned())
                })
                .collect::<Vec<_>>()
                .join(", ");
            return Some((
                ItemType::Files,
                Some(label),
                None,
                Some(joined),
                None,
                None,
            ));
        }
    }

    // Finally, try image. arboard returns decoded RGBA pixels on macOS via
    // `get_image()` when the clipboard contains a `NSImage`/`NSPasteboardTypePNG`.
    if let Ok(image) = clipboard.get_image() {
        // We persist the encoded bytes (PNG) plus mime so paste can
        // round-trip without re-encoding. The encoded blob is the most
        // portable representation across the three platforms arboard
        // supports.
        let (bytes, mime) = encode_image(&image);
        return Some((ItemType::Image, None, None, None, Some(bytes), Some(mime)));
    }

    None
}

// Encode an `ImageData` into a portable byte buffer for DB storage. PNG is
// the common denominator — macOS and Linux pasteboards already serialise
// images as PNG, and the `image` crate re-encodes Windows bitmaps into PNG
// before persisting.
fn encode_image(image: &arboard::ImageData) -> (Vec<u8>, String) {
    use std::io::Cursor;

    let width = image.width as u32;
    let height = image.height as u32;
    let buffer = image.bytes.as_ref();

    // arboard::ImageData is RGBA8 on every supported platform.
    let img = match image::RgbaImage::from_raw(width, height, buffer.to_vec()) {
        Some(i) => image::DynamicImage::ImageRgba8(i),
        None => {
            log::warn!(
                "[clipboard] image buffer size {}x{} ({} bytes) does not match RGBA pixel count",
                width,
                height,
                buffer.len()
            );
            return (Vec::new(), "image/png".into());
        }
    };

    let mut out = Cursor::new(Vec::new());
    if img.write_to(&mut out, image::ImageFormat::Png).is_err() {
        log::warn!("[clipboard] failed to encode image as PNG");
        return (Vec::new(), "image/png".into());
    }

    (out.into_inner(), "image/png".into())
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
            let Some((item_type, content, rich_text, file_paths, image_data, image_mime)) =
                capture_clipboard(&mut clipboard)
            else {
                continue;
            };

            // Fingerprint is computed on the canonical text content (when
            // available) so a plain-text copy and a rich-text copy of the
            // same string share a fingerprint and the rich copy doesn't
            // appear to be "different". Image/file items fall back to a
            // fingerprint of their label since their payload is opaque.
            let content_str = content.as_deref().unwrap_or("");
            let fingerprint = if !content_str.is_empty() {
                compute_fingerprint(content_str)
            } else if let Some(bytes) = image_data.as_ref() {
                if !bytes.is_empty() {
                    compute_fingerprint_bytes(bytes.as_slice())
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            if fingerprint.is_empty() {
                continue;
            }

            // Skip if the content matches what we last observed (or what
            // the paste path told us to ignore). The fingerprint lives in
            // AppState so a paste on the main thread can suppress this
            // tick without needing a separate channel.
            let last_fp = app
                .try_state::<AppState>()
                .and_then(|s| s.last_clipboard_fingerprint.lock().ok().map(|g| g.clone()))
                .unwrap_or_default();
            if fingerprint == last_fp {
                continue;
            }

            if clip_state.last_capture_time.elapsed() < dedup_window {
                continue;
            }

            // Check exclusion rules (text content only).
            let should_exclude = !content_str.is_empty()
                && clip_state.exclusion_rules.iter().any(|(_, pattern)| {
                    regex_lite::Regex::new(pattern).map_or(false, |re| re.is_match(content_str))
                });
            if should_exclude {
                continue;
            }

            // Commit the new fingerprint *before* persisting/emit so the
            // next tick sees a stable value even if we crash mid-write.
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut fp) = state.last_clipboard_fingerprint.lock() {
                    *fp = fingerprint.clone();
                }
            }
            clip_state.last_capture_time = Instant::now();

            let item = ClipboardItem {
                id: 0,
                item_type: item_type.as_i32(),
                content,
                rich_text,
                file_paths,
                image_data,
                image_mime,
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