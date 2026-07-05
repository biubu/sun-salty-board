use tauri::State;
use crate::state::AppState;
use crate::database::Category;

#[tauri::command]
pub fn create_category(state: State<AppState>, name: String, color: Option<String>) -> Result<Category, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = db.create_category(&name, color.as_deref()).map_err(|e| e.to_string())?;
    Ok(Category { id, name, color, created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string() })
}

#[tauri::command]
pub fn rename_category(state: State<AppState>, id: i64, name: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_category(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_category(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_category(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_categories(state: State<AppState>) -> Result<Vec<Category>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assign_category(state: State<AppState>, item_id: i64, category_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.assign_category(item_id, category_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_category(state: State<AppState>, item_id: i64, category_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_category(item_id, category_id).map_err(|e| e.to_string())
}
