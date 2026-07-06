use tauri::{AppHandle, State};
use crate::state::AppState;
use crate::database::ClipboardItem;

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
pub fn clear_history(state: State<AppState>, preserve_favorites: Option<bool>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_history(preserve_favorites.unwrap_or(true)).map_err(|e| e.to_string())
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
        "[paste_item] item found: id={} type={} content.is_some={} rich_text.is_some={}",
        item.id, item.item_type, item.content.is_some(), item.rich_text.is_some()
    );

    let content = match item.content.as_deref() {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => {
            log::warn!(
                "[paste_item] item {} has no text content (type={}); clipboard will be set but paste skipped",
                item.id, item.item_type
            );
            return Err(format!(
                "Item {} has no plain-text content (type={})",
                item.id, item.item_type
            ));
        }
    };

    log::info!("[paste_item] calling paste_content, content_len={}", content.len());
    crate::paste::paste_content(content, &app)
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
