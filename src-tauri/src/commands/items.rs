use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use crate::database::{ClipboardItem, ItemType};
use crate::paste::{self, PastePayload};

#[tauri::command]
pub fn get_items(state: State<AppState>, limit: Option<usize>, offset: Option<usize>) -> Result<Vec<ClipboardItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_items(limit.unwrap_or(100), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_items(state: State<AppState>, query: String, limit: Option<usize>) -> Result<Vec<ClipboardItem>, String> {
    if query.trim().is_empty() {
        return get_items(state, limit, Some(0));
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_items(&query, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(state: State<AppState>, id: i64) -> Result<(), String> {
    let item = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let item = db.get_item_by_id(id).map_err(|e| e.to_string())?;
        db.delete_item(id).map_err(|e| e.to_string())?;
        item
    };
    if let Some(item) = item {
        if let Ok(mut undo) = state.undo_items.lock() {
            undo.push(item);
            if undo.len() > 8 {
                undo.remove(0);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn clear_history(app: AppHandle, state: State<AppState>, preserve_favorites: Option<bool>) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.clear_history(preserve_favorites.unwrap_or(true)).map_err(|e| e.to_string())?;
    }
    // Drop the DB lock before emitting — Tauri command handlers run on the
    // main thread, and any frontend listener that tries to re-read the
    // history would otherwise deadlock waiting for the lock we still hold.
    let _ = app.emit("history-cleared", ());
    Ok(())
}

#[tauri::command]
pub fn get_item_by_id(state: State<AppState>, id: i64) -> Result<ClipboardItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_item_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())
}

#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, id: i64) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_favorite(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_favorites(state: State<AppState>) -> Result<Vec<ClipboardItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_favorites().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn paste_item(app: AppHandle, state: State<AppState>, item_id: i64) -> Result<(), String> {
    log::info!("[paste_item] command called with item_id={}", item_id);
    let item = {
        let db = state.db.lock().map_err(|e| {
            log::error!("[paste_item] db lock failed: {}", e);
            format!("db lock failed: {}", e)
        })?;
        match db.get_item_by_id(item_id) {
            Ok(Some(i)) => i,
            Ok(None) => {
                log::warn!("[paste_item] item {} not found", item_id);
                return Err(format!("Item {} not found", item_id));
            }
            Err(e) => {
                log::error!("[paste_item] db error: {}", e);
                return Err(format!("db error: {}", e));
            }
        }
    };
    log::info!(
        "[paste_item] item found: id={} type={} content.is_some={} rich_text.is_some={} files={} image_bytes={}",
        item.id,
        item.item_type,
        item.content.is_some(),
        item.rich_text.is_some(),
        item.file_paths.as_ref().map(|s| s.lines().count()).unwrap_or(0),
        item.image_data.as_ref().map(|b| b.len()).unwrap_or(0),
    );

    let item_type = match item.item_type {
        0 => ItemType::Text,
        1 => ItemType::Richtext,
        2 => ItemType::Image,
        3 => ItemType::Files,
        other => {
            log::warn!(
                "[paste_item] item {} has unknown type {}; defaulting to Text",
                item.id,
                other
            );
            ItemType::Text
        }
    };

    // Normalise the optional payload into borrows the paste helper expects.
    // Each branch pulls the field that matches the item type and leaves the
    // others None so `paste_payload` knows exactly what to do.
    let content_ref = item.content.as_deref();
    let rich_text_ref = item.rich_text.as_deref();
    let file_paths_ref_owned: Option<Vec<String>> = item
        .file_paths
        .as_ref()
        .map(|s| s.lines().filter(|p| !p.is_empty()).map(|s| s.to_string()).collect());
    let file_paths_ref: Option<&[String]> = file_paths_ref_owned.as_deref();
    let image_data_ref = item.image_data.as_deref();
    let image_mime_ref = item.image_mime.as_deref();

    let payload = PastePayload {
        item_type,
        content: content_ref,
        rich_text: rich_text_ref,
        file_paths: file_paths_ref,
        image_data: image_data_ref,
        image_mime: image_mime_ref,
    };
    paste::paste_payload(payload, &app)
}

#[tauri::command]
pub fn undo_delete(state: State<AppState>) -> Result<Option<ClipboardItem>, String> {
    let item = {
        let mut undo = state.undo_items.lock().map_err(|e| e.to_string())?;
        undo.pop()
    };
    if let Some(ref item) = item {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.insert_item(item).map_err(|e| e.to_string())?;
    }
    Ok(item)
}