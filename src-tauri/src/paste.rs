use arboard::Clipboard;
use sha2::{Sha256, Digest};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::database::ItemType;
use crate::state::AppState;

static PASTE_LAST_END: Mutex<Option<Instant>> = Mutex::new(None);

fn fingerprint_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn fingerprint_text(text: &str) -> String {
    fingerprint_bytes(text.as_bytes())
}

fn set_last_fingerprint(app: &AppHandle, fingerprint: String) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut fp) = state.last_clipboard_fingerprint.lock() {
            *fp = fingerprint;
        }
    }
}

// Persist `bytes` (and optional `mime`) onto the system clipboard as the
// richest available representation. Caller is responsible for also setting
// any plain-text fallback via `set_clipboard_text` when appropriate.
fn set_clipboard_image(bytes: &[u8], mime: &str) -> Result<(), String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("failed to decode stored image (mime={mime}): {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let image = arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
    };
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    cb.set_image(image)
        .map_err(|e| format!("Failed to set clipboard image: {}", e))?;
    Ok(())
}

fn set_clipboard_text(text: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    cb.set_text(text)
        .map_err(|e| format!("Failed to set clipboard text: {}", e))?;
    Ok(())
}

fn set_clipboard_html(html: &str, alt: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    cb.set_html(html, Some(alt))
        .map_err(|e| format!("Failed to set clipboard html: {}", e))?;
    Ok(())
}

fn set_clipboard_files(paths: &[String]) -> Result<(), String> {
    use std::path::PathBuf;
    let pbs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    cb.set().file_list(pbs.as_slice())
        .map_err(|e| format!("Failed to set clipboard file list: {}", e))?;
    Ok(())
}

// Read whatever is currently on the clipboard, in the same priority order
// `clipboard::capture_clipboard` uses, so the "original" snapshot taken
// before a paste round-trips through the same fallback rules. Returns
// `None` if nothing on the clipboard can be represented.
enum ClipboardSnapshot {
    Text(String, Option<String>), // text, optional html
    Image(Vec<u8>),
    Files(Vec<String>),
    Empty,
}

fn snapshot_clipboard() -> ClipboardSnapshot {
    let Ok(mut cb) = Clipboard::new() else {
        return ClipboardSnapshot::Empty;
    };
    if let Ok(text) = cb.get_text() {
        if !text.is_empty() {
            let html = cb.get().html().ok().filter(|h| !h.is_empty());
            return ClipboardSnapshot::Text(text, html);
        }
    }
    if let Ok(image) = cb.get_image() {
        return ClipboardSnapshot::Image(image.bytes.as_ref().to_vec());
    }
    if let Ok(paths) = cb.get().file_list() {
        if !paths.is_empty() {
            return ClipboardSnapshot::Files(
                paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect(),
            );
        }
    }
    ClipboardSnapshot::Empty
}

fn fingerprint_of_snapshot(snap: &ClipboardSnapshot) -> String {
    match snap {
        ClipboardSnapshot::Text(text, html) => {
            // Prefer the HTML fingerprint when present so a rich restore
            // collides with the rich original even if the alt-text happens
            // to match some other item.
            if let Some(h) = html {
                return fingerprint_text(h);
            }
            fingerprint_text(text)
        }
        ClipboardSnapshot::Image(bytes) => fingerprint_bytes(bytes),
        ClipboardSnapshot::Files(paths) => fingerprint_text(&paths.join("\n")),
        ClipboardSnapshot::Empty => String::new(),
    }
}

fn restore_snapshot(snap: ClipboardSnapshot) {
    let result: Result<(), String> = match snap {
        ClipboardSnapshot::Text(text, Some(html)) => set_clipboard_html(&html, &text),
        ClipboardSnapshot::Text(text, None) => set_clipboard_text(&text),
        ClipboardSnapshot::Image(bytes) => {
            // We only stored the encoded bytes via the paste path;
            // reconstruct the image via the `image` crate so arboard can
            // hand it back to the next reader.
            set_clipboard_image(&bytes, "image/png")
        }
        ClipboardSnapshot::Files(paths) => set_clipboard_files(&paths),
        ClipboardSnapshot::Empty => Ok(()),
    };
    if let Err(e) = result {
        log::warn!("[paste] failed to restore clipboard snapshot: {}", e);
    }
}

pub struct PastePayload<'a> {
    pub item_type: ItemType,
    pub content: Option<&'a str>,
    pub rich_text: Option<&'a str>,
    pub file_paths: Option<&'a [String]>,
    pub image_data: Option<&'a [u8]>,
    pub image_mime: Option<&'a str>,
}

pub fn paste_payload(payload: PastePayload<'_>, app: &tauri::AppHandle) -> Result<(), String> {
    log::info!(
        "[paste_payload] called, type={:?} content_len={} html_len={} files={} image_bytes={}",
        payload.item_type,
        payload.content.map(|s| s.len()).unwrap_or(0),
        payload.rich_text.map(|s| s.len()).unwrap_or(0),
        payload.file_paths.map(|v| v.len()).unwrap_or(0),
        payload.image_data.map(|b| b.len()).unwrap_or(0),
    );

    {
        let mut last = PASTE_LAST_END.lock().map_err(|e| {
            log::error!("[paste_payload] guard lock failed: {}", e);
            format!("guard poisoned: {}", e)
        })?;
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_millis(1500) {
                log::warn!(
                    "[paste_payload] previous paste ended {}ms ago, skipping to prevent burst",
                    t.elapsed().as_millis()
                );
                return Ok(());
            }
        }
    }

    // Snapshot the user's current clipboard before we touch it so we can
    // restore it after the target app has finished consuming the paste.
    let original = snapshot_clipboard();
    let original_fp = fingerprint_of_snapshot(&original);
    let original_is_empty = matches!(original, ClipboardSnapshot::Empty);

    // Place the payload onto the clipboard. Track the fingerprint we just
    // produced so the monitor thread doesn't immediately bounce this back
    // as a brand-new history entry.
    let pasted_fp = match payload.item_type {
        ItemType::Text => {
            let text = payload
                .content
                .ok_or_else(|| "Text item has empty content".to_string())?;
            set_clipboard_text(text)?;
            fingerprint_text(text)
        }
        ItemType::Richtext => {
            let text = payload
                .content
                .ok_or_else(|| "Rich-text item has no plain-text fallback".to_string())?;
            let html = payload.rich_text.unwrap_or(text);
            set_clipboard_html(html, text)?;
            fingerprint_text(html)
        }
        ItemType::Image => {
            let bytes = payload
                .image_data
                .ok_or_else(|| "Image item has no pixel data".to_string())?;
            if bytes.is_empty() {
                return Err("Image item has empty pixel data".into());
            }
            let mime = payload.image_mime.unwrap_or("image/png");
            set_clipboard_image(bytes, mime)?;
            fingerprint_bytes(bytes)
        }
        ItemType::Files => {
            let paths = payload
                .file_paths
                .ok_or_else(|| "File item has no paths".to_string())?;
            if paths.is_empty() {
                return Err("File item has empty path list".into());
            }
            let joined = paths.join("\n");
            set_clipboard_files(paths)?;
            fingerprint_text(&joined)
        }
    };
    set_last_fingerprint(app, pasted_fp);

    log::info!("[paste_payload] clipboard set OK, dispatching paste");
    do_paste(app)?;

    // Give the target app time to consume the clipboard BEFORE we restore
    // the original. 300ms is enough for the Cmd+V keystroke to traverse
    // the event pipeline, the target app to issue its NSPasteboard read,
    // and the read to complete — even on slower editors. If the snapshot
    // was empty we still want a short pause so the paste registers before
    // any subsequent poll of the clipboard.
    thread::sleep(Duration::from_millis(300));

    if !original_is_empty {
        restore_snapshot(original);
        set_last_fingerprint(app, original_fp);
    }

    if let Ok(mut last) = PASTE_LAST_END.lock() {
        *last = Some(Instant::now());
    }

    log::info!("[paste_payload] done");
    Ok(())
}

// Convenience wrapper for the common case where the caller only has a
// plain-text string. Routes through `paste_payload` so all the snapshot /
// fingerprint / type-routing logic stays in one place. Kept available so
// future commands (e.g. a "copy as plain text" action) can reuse it
// without re-implementing the snapshot dance.
#[allow(dead_code)]
pub fn paste_text(text: &str, app: &tauri::AppHandle) -> Result<(), String> {
    paste_payload(
        PastePayload {
            item_type: ItemType::Text,
            content: Some(text),
            rich_text: None,
            file_paths: None,
            image_data: None,
            image_mime: None,
        },
        app,
    )
}

#[cfg(target_os = "macos")]
fn do_paste(app: &tauri::AppHandle) -> Result<(), String> {
    macos::do_paste(app)
}

#[cfg(target_os = "windows")]
fn do_paste(_app: &tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("powershell")
        .args(["-Command", "[System.Windows.Forms.SendKeys]::SendWait('^v')"])
        .output()
        .map_err(|e| format!("Paste failed on Windows: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Windows paste failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn do_paste(_app: &tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("xdotool")
        .args(["key", "--clearmodifiers", "ctrl+v"])
        .output()
        .map_err(|e| format!("Paste failed on Linux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Linux paste failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn save_frontmost_app(app: &tauri::AppHandle) {
    if let Some((bundle_id, pid)) = macos::frontmost_app_info() {
        let bid_lower = bundle_id.to_lowercase();
        if bid_lower.contains("sunsalty")
            || bid_lower.contains("sun-salty")
            || bid_lower.contains("sun_salty")
            || bid_lower.is_empty()
        {
            log::debug!("[paste] skip saving frontmost: '{}'", bundle_id);
            return;
        }
        log::info!("[paste] saved frontmost: bundle={} pid={}", bundle_id, pid);
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut b) = state.previous_app_bundle_id.lock() {
                *b = Some(bundle_id);
            }
            if let Ok(mut p) = state.previous_app_pid.lock() {
                *p = Some(pid);
            }
        }
    } else {
        log::warn!("[paste] could not read frontmost app");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn save_frontmost_app(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CStr;
    use std::thread;
    use std::time::Duration;
    use tauri::Manager;

    const KEY_V: u16 = 9;
    const ACTIVATE_ALL_WINDOWS: u64 = 1;
    const ACTIVATE_IGNORING_OTHER: u64 = 2;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }

    pub fn is_accessibility_trusted() -> bool {
        unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) }
    }

    pub fn frontmost_app_info() -> Option<(String, i32)> {
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
            let bundle_id = if bid != nil {
                let utf8: *const i8 = msg_send![bid, UTF8String];
                if utf8.is_null() {
                    String::new()
                } else {
                    CStr::from_ptr(utf8).to_string_lossy().into_owned()
                }
            } else {
                String::new()
            };
            let pid: i32 = msg_send![app, processIdentifier];
            Some((bundle_id, pid))
        }
    }

    fn find_app_by_bundle_id(bundle_id: &str) -> Option<cocoa::base::id> {
        use cocoa::base::{id, nil};
        use objc::{class, msg_send, sel, sel_impl};
        unsafe {
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            if workspace == nil {
                return None;
            }
            let running: id = msg_send![workspace, runningApplications];
            let count: usize = msg_send![running, count];
            for i in 0..count {
                let app: id = msg_send![running, objectAtIndex: i];
                if app == nil {
                    continue;
                }
                let bid: id = msg_send![app, bundleIdentifier];
                if bid == nil {
                    continue;
                }
                let utf8: *const i8 = msg_send![bid, UTF8String];
                if utf8.is_null() {
                    continue;
                }
                let id_str = CStr::from_ptr(utf8).to_string_lossy();
                if id_str == bundle_id {
                    return Some(app);
                }
            }
            None
        }
    }

    fn find_app_by_pid(pid: i32) -> Option<cocoa::base::id> {
        use cocoa::base::{id, nil};
        use objc::{class, msg_send, sel, sel_impl};
        unsafe {
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            if workspace == nil {
                return None;
            }
            let running: id = msg_send![workspace, runningApplications];
            let count: usize = msg_send![running, count];
            for i in 0..count {
                let app: id = msg_send![running, objectAtIndex: i];
                if app == nil {
                    continue;
                }
                let p: i32 = msg_send![app, processIdentifier];
                if p == pid {
                    return Some(app);
                }
            }
            None
        }
    }

    fn find_first_regular_app() -> Option<(cocoa::base::id, String)> {
        use cocoa::base::{id, nil, BOOL, YES};
        use objc::{class, msg_send, sel, sel_impl};
        unsafe {
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            if workspace == nil {
                return None;
            }
            let running: id = msg_send![workspace, runningApplications];
            let count: usize = msg_send![running, count];
            for i in 0..count {
                let app: id = msg_send![running, objectAtIndex: i];
                if app == nil {
                    continue;
                }
                let bid: id = msg_send![app, bundleIdentifier];
                if bid == nil {
                    continue;
                }
                let utf8: *const i8 = msg_send![bid, UTF8String];
                if utf8.is_null() {
                    continue;
                }
                let id_str = CStr::from_ptr(utf8).to_string_lossy().to_lowercase();
                if id_str.contains("sunsalty")
                    || id_str.contains("sun-salty")
                    || id_str.contains("sun_salty")
                    || id_str.is_empty()
                {
                    continue;
                }
                let policy: isize = msg_send![app, activationPolicy];
                if policy != 0 {
                    continue;
                }
                let is_hidden: BOOL = msg_send![app, isHidden];
                if is_hidden == YES {
                    continue;
                }
                let name = id_str;
                return Some((app, name));
            }
            None
        }
    }

    fn activate_app(app: cocoa::base::id) -> bool {
        use cocoa::base::id;
        use objc::{msg_send, sel, sel_impl};
        unsafe {
            let ok: bool = msg_send![app, activateWithOptions: ACTIVATE_IGNORING_OTHER];
            ok
        }
    }

    fn deactivate_self() {
        use cocoa::base::{id, nil};
        use objc::{class, msg_send, sel, sel_impl};
        unsafe {
            let app: id = msg_send![class!(NSApplication), sharedApplication];
            if app == nil {
                return;
            }
            let _: () = msg_send![app, deactivate];
        }
    }

    pub fn do_paste(app: &tauri::AppHandle) -> Result<(), String> {
        // The accessibility permission check below is purely diagnostic —
        // CGEventPost will silently fail if the app isn't trusted. Logging
        // the result lets users diagnose "paste does nothing" without
        // having to attach a debugger. They still need to grant BOTH:
        //   System Settings -> Privacy & Security -> Accessibility
        //   System Settings -> Privacy & Security -> Input Monitoring
        // on macOS Catalina and later. We don't request either here because
        // macOS shows those prompts only when an actual CGEvent is posted
        // to another process; surfacing them proactively is a UI change
        // for another day.
        let trusted = is_accessibility_trusted();
        if !trusted {
            log::warn!(
                "[paste] Accessibility NOT granted. Grant in System Settings -> Privacy & Security -> Accessibility AND Input Monitoring, then restart the app."
            );
        } else {
            log::info!("[paste] Accessibility OK");
        }

        let saved_bundle = app
            .try_state::<crate::state::AppState>()
            .and_then(|s| s.previous_app_bundle_id.lock().ok().and_then(|g| g.clone()));
        let saved_pid = app
            .try_state::<crate::state::AppState>()
            .and_then(|s| s.previous_app_pid.lock().ok().and_then(|g| *g));
        log::info!(
            "[paste] saved previous: bundle={:?} pid={:?}",
            saved_bundle,
            saved_pid
        );

        // Order matters:
        //   1. release app-level focus so the next activate is honored
        //   2. short pause for the window server to process the release
        //   3. activate the previously frontmost app (saved at hotkey time)
        //   4. longer pause so the target's main run loop becomes key
        //   5. post Cmd+V via HID — target app reads NSPasteboard
        // On the macOS window server, activations take ~80–150ms to
        // propagate to the foreground process; we sleep generously so the
        // keystroke isn't lost to a stale focus state.
        log::info!("[paste] deactivating self...");
        deactivate_self();
        thread::sleep(Duration::from_millis(80));

        let mut activated_name = String::new();
        if let Some(bid) = saved_bundle.as_deref() {
            if let Some(target) = find_app_by_bundle_id(bid) {
                if activate_app(target) {
                    activated_name = bid.to_string();
                    log::info!("[paste] activate by bundle id '{}' OK", bid);
                } else {
                    log::warn!("[paste] activate by bundle id '{}' returned false", bid);
                }
            } else {
                log::warn!("[paste] no running app with bundle id '{}'", bid);
            }
        }
        if activated_name.is_empty() {
            if let Some(pid) = saved_pid {
                if let Some(target) = find_app_by_pid(pid) {
                    if activate_app(target) {
                        activated_name = format!("pid:{}", pid);
                        log::info!("[paste] activate by pid {} OK", pid);
                    } else {
                        log::warn!("[paste] activate by pid {} returned false", pid);
                    }
                }
            }
        }
        if activated_name.is_empty() {
            log::warn!("[paste] no saved previous app; picking first regular app");
            if let Some((target, name)) = find_first_regular_app() {
                if activate_app(target) {
                    activated_name = format!("fallback:{}", name);
                    log::info!("[paste] activate fallback '{}' OK", name);
                }
            }
        }

        // 250ms (was 200ms) lets the activation settle before we post the
        // keystroke. macOS sometimes needs >200ms on slow disks or when
        // the target is the first process to become foreground after a
        // long idle period.
        thread::sleep(Duration::from_millis(250));

        log::info!("[paste] posting Cmd+V via CGEventPost...");
        if !trusted {
            // Surface the most likely failure mode to the operator instead
            // of swallowing it — pasting into other apps is impossible
            // without this permission on macOS.
            return Err(
                "Accessibility permission is required to paste into other apps. \
                 Open System Settings -> Privacy & Security -> Accessibility and \
                 Input Monitoring, grant SunSaltyBoard, then restart the app."
                    .into(),
            );
        }
        send_paste_keystroke()?;
        log::info!("[paste] dispatched keystroke to: {}", activated_name);
        Ok(())
    }

    fn send_paste_keystroke() -> Result<(), String> {
        use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|e| format!("CGEventSource::new failed: {:?}", e))?;

        let event_down = CGEvent::new_keyboard_event(source.clone(), KEY_V, true)
            .map_err(|e| format!("CGEvent::new_keyboard_event down failed: {:?}", e))?;
        event_down.set_flags(CGEventFlags::CGEventFlagCommand);
        event_down.post(CGEventTapLocation::HID);

        thread::sleep(Duration::from_millis(20));

        let event_up = CGEvent::new_keyboard_event(source, KEY_V, false)
            .map_err(|e| format!("CGEvent::new_keyboard_event up failed: {:?}", e))?;
        event_up.set_flags(CGEventFlags::CGEventFlagCommand);
        event_up.post(CGEventTapLocation::HID);

        let _ = ACTIVATE_ALL_WINDOWS;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn check_accessibility_and_log() {
    if !macos::is_accessibility_trusted() {
        log::warn!(
            "[startup] macOS Accessibility NOT granted. Pasting into other apps will NOT work until granted in System Settings -> Privacy & Security -> Accessibility AND Input Monitoring."
        );
    } else {
        log::info!("[startup] macOS Accessibility granted.");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn check_accessibility_and_log() {}