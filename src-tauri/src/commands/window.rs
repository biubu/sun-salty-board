use std::process::Command;
use tauri::Manager;

pub fn get_cursor_position() -> Option<(i32, i32)> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to get position of mouse"#])
            .output()
            .ok()?;
        let s = String::from_utf8(output.stdout).ok()?;
        let parts: Vec<&str> = s.trim().split(&[',', ' '][..]).filter(|p| !p.is_empty()).collect();
        if parts.len() >= 2 {
            let x: i32 = parts[0].parse().ok()?;
            let y: i32 = parts[1].parse().ok()?;
            return Some((x, y));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(["-Command", "[System.Windows.Forms.Cursor]::Position.X.ToString() + ',' + [System.Windows.Forms.Cursor]::Position.Y.ToString()"])
            .output()
            .ok()?;
        let s = String::from_utf8(output.stdout).ok()?;
        let parts: Vec<&str> = s.trim().split(',').collect();
        if parts.len() >= 2 {
            let x: i32 = parts[0].trim().parse().ok()?;
            let y: i32 = parts[1].trim().parse().ok()?;
            return Some((x, y));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdotool")
            .args(["getmouselocation", "--shell"])
            .output()
            .ok()?;
        let s = String::from_utf8(output.stdout).ok()?;
        for line in s.lines() {
            if let Some(x_str) = line.strip_prefix("X=") {
                if let Some(y_line) = s.lines().find(|l| l.starts_with("Y=")) {
                    let x: i32 = x_str.trim().parse().ok()?;
                    let y: i32 = y_line[2..].trim().parse().ok()?;
                    return Some((x, y));
                }
            }
        }
    }

    None
}

#[tauri::command]
pub fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let pos = get_cursor_position();
        if let Some((x, y)) = pos {
            let _ = window.set_position(tauri::PhysicalPosition::new(
                x.saturating_sub(240),
                y.saturating_sub(30),
            ));
        }
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            let pos = get_cursor_position();
            if let Some((x, y)) = pos {
                let _ = window.set_position(tauri::PhysicalPosition::new(
                    x.saturating_sub(240),
                    y.saturating_sub(30),
                ));
            }
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
