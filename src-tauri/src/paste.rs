use arboard::Clipboard;
use std::process::Command;

fn save_clipboard() -> Result<(Option<String>, Option<arboard::ImageData<'static>>), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    let text = cb.get_text().ok();
    let image = cb.get_image().ok().map(|img| {
        arboard::ImageData {
            width: img.width,
            height: img.height,
            bytes: img.bytes.into_owned().into(),
        }
    });
    Ok((text, image))
}

fn restore_clipboard(text: Option<&str>, image: Option<&arboard::ImageData>) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    if let Some(t) = text {
        cb.set_text(t).ok();
    } else if let Some(img) = image {
        cb.set_image(img.clone()).ok();
    }
    Ok(())
}

pub fn simulate_paste() -> Result<(), String> {
    let (saved_text, saved_image) = save_clipboard()?;

    let result = do_paste();

    if let Err(e) = restore_clipboard(saved_text.as_deref(), saved_image.as_ref()) {
        log::warn!("Failed to restore clipboard after paste: {}", e);
    }

    result
}

fn do_paste() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to keystroke "v" using command down"#])
            .output()
            .map_err(|e| format!("Paste failed on macOS: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("powershell")
            .args(["-Command", "[System.Windows.Forms.SendKeys]::SendWait('^v')"])
            .output()
            .map_err(|e| format!("Paste failed on Windows: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdotool")
            .args(["key", "--clearmodifiers", "ctrl+v"])
            .output()
            .map_err(|e| format!("Paste failed on Linux: {}", e))?;
    }

    Ok(())
}
