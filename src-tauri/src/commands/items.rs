use tauri::State;
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
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_item(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(state: State<AppState>, preserve_favorites: Option<bool>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_history(preserve_favorites.unwrap_or(true)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_item_by_id(state: State<AppState>, id: i64) -> Result<ClipboardItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let items = db.get_items(1, 0).map_err(|e| e.to_string())?;
    items.into_iter().find(|i| i.id == id).ok_or_else(|| "Item not found".to_string())
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
pub fn paste_item(_state: State<AppState>) -> Result<(), String> {
    crate::paste::simulate_paste().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn undo_delete(_state: State<AppState>) -> Result<Option<ClipboardItem>, String> {
    Ok(None)
}
