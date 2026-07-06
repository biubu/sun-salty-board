use serde::Serialize;
use tauri::State;
use crate::state::AppState;

#[derive(Serialize)]
pub struct AppStats {
    pub total_items: i64,
    pub today_items: i64,
    pub favorite_items: i64,
    pub db_size: u64,
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<AppStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (total, today) = db.get_stats().map_err(|e| e.to_string())?;
    drop(db);
    let favorite_items = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_favorites_count().map_err(|e| e.to_string())?
    };
    let db_size = std::fs::metadata(&state.db_path).map(|m| m.len()).unwrap_or(0);
    Ok(AppStats { total_items: total, today_items: today, favorite_items, db_size })
}
