use std::str::FromStr;

use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::state::AppState;

// User-tunable global shortcut. Validates the new binding against the
// plugin's Shortcut parser BEFORE swapping, so a typo like "Alot+Shift+V"
// never leaves the user without a working shortcut. On success the new
// binding replaces the old one in AppState and at the OS level.
//
// On any rollback path the previous shortcut stays active; we never end
// up with no shortcut registered.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    let hotkey = hotkey.trim().to_string();
    if hotkey.is_empty() {
        return Err("hotkey cannot be empty".to_string());
    }

    // Parse-only — fail fast if the plugin can't represent it. We do this
    // before unregister so a bad string can't orphan the existing binding.
    Shortcut::from_str(&hotkey)
        .map_err(|e| format!("invalid hotkey '{}': {}", hotkey, e))?;

    let current = state
        .current_hotkey
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if hotkey == current {
        return Ok(());
    }

    let gs = app.global_shortcut();

    // Register the new shortcut first. If the OS refuses (already
    // claimed by another app, etc.) we leave the existing binding alone.
    if let Err(e) = gs.register(hotkey.as_str()) {
        return Err(format!(
            "could not register '{}': {}. Old shortcut '{}' remains active.",
            hotkey, e, current
        ));
    }

    // Newly registered. Drop the old binding and update state only if
    // both succeed. If unregister fails the new one is already in place
    // and we keep using it — the OS will free the old one when this
    // process exits anyway.
    if let Err(e) = gs.unregister(current.as_str()) {
        log::warn!(
            "[hotkey] could not unregister previous shortcut '{}': {}. New shortcut '{}' is live.",
            current, e, hotkey
        );
    }

    *state
        .current_hotkey
        .lock()
        .map_err(|e| e.to_string())? = hotkey.clone();

    log::info!("[hotkey] re-registered: {} -> {}", current, hotkey);
    Ok(())
}

#[tauri::command]
pub fn get_hotkey(state: State<AppState>) -> Result<String, String> {
    Ok(state
        .current_hotkey
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
