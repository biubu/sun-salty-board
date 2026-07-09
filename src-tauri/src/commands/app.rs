#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_platform() -> String {
    #[cfg(target_os = "macos")]
    { "macos".to_string() }
    #[cfg(target_os = "windows")]
    { "windows".to_string() }
    #[cfg(target_os = "linux")]
    { "linux".to_string() }
}

// Returns one of: "macos", "windows", "linux-x11", "linux-wayland",
// "linux-other". The linux split is what the frontend cares about —
// Wayland sessions can't have synthetic keystrokes injected via
// xdotool (the X11 tool can't reach Wayland surfaces), so the UI
// needs to fall back to a "clipboard is set, press Ctrl+V manually"
// toast on those sessions.
#[tauri::command]
pub fn get_session_type() -> String {
    #[cfg(target_os = "macos")]
    { return "macos".to_string(); }
    #[cfg(target_os = "windows")]
    { return "windows".to_string(); }
    #[cfg(target_os = "linux")]
    {
        if is_wayland_session() {
            return "linux-wayland".to_string();
        }
        if std::env::var("DISPLAY").is_ok() {
            return "linux-x11".to_string();
        }
        return "linux-other".to_string();
    }
    #[allow(unreachable_code)]
    { "other".to_string() }
}

// True when the current process is running inside a Wayland session.
// Detection order matches the common convention: XDG_SESSION_TYPE is
// the explicit signal set by login managers / display managers, while
// WAYLAND_DISPLAY is the lower-level environment that wlroots-based
// compositors (Sway, Hyprland) always export. Either being set means
// we should not attempt xdotool.
#[cfg(target_os = "linux")]
pub fn is_wayland_session() -> bool {
    if let Ok(t) = std::env::var("XDG_SESSION_TYPE") {
        if t.eq_ignore_ascii_case("wayland") {
            return true;
        }
    }
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return true;
    }
    false
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub fn is_wayland_session() -> bool {
    false
}

#[tauri::command]
pub fn log_to_rust(level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[frontend] {}", msg),
        "warn" => log::warn!("[frontend] {}", msg),
        _ => log::info!("[frontend] {}", msg),
    }
}
