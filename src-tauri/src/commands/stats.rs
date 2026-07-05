use serde::Serialize;
use tauri::State;
use crate::state::AppState;

#[derive(Serialize)]
pub struct AppStats {
    pub total_items: i64,
    pub today_items: i64,
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<AppStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (total, today) = db.get_stats().map_err(|e| e.to_string())?;
    Ok(AppStats { total_items: total, today_items: today })
}
