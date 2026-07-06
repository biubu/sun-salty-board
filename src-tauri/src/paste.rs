use arboard::Clipboard;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

static PASTE_LAST_END: Mutex<Option<Instant>> = Mutex::new(None);

pub fn paste_content(content: String, app: &tauri::AppHandle) -> Result<(), String> {
    log::info!("[paste_content] called, content_len={}", content.len());

    {
        let mut last = PASTE_LAST_END.lock().map_err(|e| {
            log::error!("[paste_content] guard lock failed: {}", e);
            format!("guard poisoned: {}", e)
        })?;
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_millis(1500) {
                log::warn!(
                    "[paste_content] previous paste ended {}ms ago, skipping to prevent burst",
                    t.elapsed().as_millis()
                );
                return Ok(());
            }
        }
    }

    let mut cb = Clipboard::new().map_err(|e| {
        log::error!("[paste_content] clipboard open failed: {}", e);
        format!("Failed to open clipboard: {}", e)
    })?;

    let original = cb.get_text().ok();

    cb.set_text(&content).map_err(|e| {
        log::error!("[paste_content] clipboard set_text failed: {}", e);
        format!("Failed to set clipboard text: {}", e)
    })?;
    drop(cb);

    log::info!("[paste_content] clipboard set OK, dispatching paste");
    do_paste(app)?;

    if let Some(orig) = original {
        thread::sleep(Duration::from_millis(300));
        let mut cb = Clipboard::new().map_err(|e| {
            log::error!("[paste_content] clipboard reopen failed: {}", e);
            format!("Failed to open clipboard: {}", e)
        })?;
        let _ = cb.set_text(&orig);
    }

    if let Ok(mut last) = PASTE_LAST_END.lock() {
        *last = Some(Instant::now());
    }

    log::info!("[paste_content] done");
    Ok(())
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
        if let Some(state) = app.try_state::<crate::state::AppState>() {
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
        if !is_accessibility_trusted() {
            log::warn!(
                "[paste] Accessibility NOT granted. Grant in System Settings -> Privacy & Security -> Accessibility, then restart."
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

        thread::sleep(Duration::from_millis(200));

        log::info!("[paste] posting Cmd+V via CGEventPost...");
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
            "[startup] macOS Accessibility NOT granted. Pasting into other apps will NOT work until granted in System Settings -> Privacy & Security -> Accessibility."
        );
    } else {
        log::info!("[startup] macOS Accessibility granted.");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn check_accessibility_and_log() {}