use arboard::Clipboard;
use sha2::{Sha256, Digest};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use crate::database::{ClipboardItem, ItemType};
use crate::state::AppState;

#[derive(Clone)]
enum ExclusionRule {
    // Regex matched against the captured text content.
    Content(String),
    // Regex matched against the frontmost app's bundle identifier (macOS)
    // or window title (Linux X11 / Windows). On platforms without a
    // frontmost-app probe the field is `None` and App rules are skipped.
    App(String),
}

struct ClipboardState {
    last_capture_time: Instant,
    exclusion_rules: Vec<ExclusionRule>,
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

// Pull user-configured exclusion lists out of the `settings` table and
// rebuild the in-memory rule vectors. Called at startup and again every
// 30s from the polling loop so updates made via the Settings overlay take
// effect without a restart.
fn load_exclusion_rules(app: &AppHandle, clip_state: &mut ClipboardState) {
    let mut new_rules: Vec<ExclusionRule> = Vec::new();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(db) = state.db.lock() {
            if let Ok(mut stmt) = db.conn().prepare(
                "SELECT key, value FROM settings WHERE key IN ('exclusionPatterns', 'exclusionApps')"
            ) {
                if let Ok(mut rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    while let Some(row) = rows.next().transpose().ok().flatten() {
                        let (key, value) = row;
                        let kind = match key.as_str() {
                            "exclusionApps" => ExclusionRule::App,
                            _ => ExclusionRule::Content,
                        };
                        for pattern in value.lines().filter(|p| !p.is_empty()) {
                            new_rules.push(kind(pattern.to_string()));
                        }
                    }
                }
            }
        }
    }
    clip_state.exclusion_rules = new_rules;
}

// Probe the OS for the frontmost app's identifying string. Returns
// * `Some(bundle_id)` on macOS (NSWorkspace bundleIdentifier);
// * `Some(window_title)` on Linux X11 (xdotool active window name);
// * `Some(process_name)` on Windows (PowerShell foreground process name);
// * `None` everywhere else (e.g. Wayland, where the compositor refuses
//   to expose the focused surface to non-virtual-keyboard clients).
//
// App-level exclusion rules are skipped when this returns None rather
// than silently dropping them — the user can still see what's configured
// in Settings and the bug surface stays confined to a log line.
fn frontmost_app_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::base::{id, nil};
        use objc::{class, msg_send, sel, sel_impl};
        unsafe {
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            if workspace == nil {
                return None;
            }
            let app: id = msg_send![workspace, frontmostApplication];
            if app == nil {
                return None;
            }
            let bid: id = msg_send![app, bundleIdentifier];
            if bid == nil {
                return None;
            }
            let utf8: *const i8 = msg_send![bid, UTF8String];
            if utf8.is_null() {
                return None;
            }
            Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Fall back to the executable name of the foreground window's
        // owning process — precise enough to match against user-typed
        // patterns like "1Password.exe" or "KeePass.exe". Falls through
        // with `None` if no window has a real MainWindowHandle (e.g.
        // headless console), which is the correct behaviour for an App
        // rule we can't evaluate.
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | Sort-Object -Descending LastAccessTime | Select-Object -First 1 -ExpandProperty ProcessName",
            ])
            .output()
            .ok()?;
        let s = String::from_utf8(output.stdout).ok()?;
        let name = s.trim();
        if name.is_empty() {
            return None;
        }
        Some(name.to_string())
    }

    #[cfg(target_os = "linux")]
    {
        // Wayland compositors don't expose the focused surface to xdotool,
        // so this call returns no useful data — bail out early and the
        // App exclusion rule path becomes a no-op (logged in caller).
        if crate::commands::app::is_wayland_session() {
            return None;
        }
        let output = std::process::Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
            .ok()?;
        let s = String::from_utf8(output.stdout).ok()?;
        if s.trim().is_empty() {
            return None;
        }
        Some(s.trim().to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
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
    // Pull the user's exclusion rules into memory before the polling
    // starts so the very first captured clipboard item can be filtered.
    // Without this, freshly-added exclusions would silently miss up to
    // 30s of captures — long enough to leak a password-manager entry
    // the user just told us to ignore.
    load_exclusion_rules(&app, &mut clip_state);
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

            // Check exclusion rules. Each rule is matched against the most
            // relevant target: Content rules against the captured text,
            // App rules against the frontmost app's identifier (when the
            // platform exposes one). On platforms without a frontmost-app
            // probe (Wayland, etc.) App rules are skipped — not silently
            // evaluated against an empty string.
            let frontmost = frontmost_app_id();
            let content_hit = !content_str.is_empty()
                && clip_state.exclusion_rules.iter().any(|r| match r {
                    ExclusionRule::Content(p) => {
                        regex_lite::Regex::new(p).map_or(false, |re| re.is_match(content_str))
                    }
                    ExclusionRule::App(_) => false,
                });
            let app_hit = match &frontmost {
                Some(app_id) => clip_state.exclusion_rules.iter().any(|r| match r {
                    ExclusionRule::App(p) => {
                        regex_lite::Regex::new(p).map_or(false, |re| re.is_match(app_id))
                    }
                    ExclusionRule::Content(_) => false,
                }),
                None => false,
            };
            if content_hit || app_hit {
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