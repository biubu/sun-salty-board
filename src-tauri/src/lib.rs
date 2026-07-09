mod database;
mod clipboard;
mod commands;
mod tray;
mod updater;
mod paste;
mod state;

use state::AppState;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Modifiers, GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state == ShortcutState::Pressed
                    && shortcut.matches(Modifiers::ALT | Modifiers::SHIFT, Code::KeyV)
                {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            crate::paste::save_frontmost_app(app);
                            let pos = crate::commands::window::get_cursor_position();
                            if let Some((x, y)) = pos {
                                let w = 480;
                                let h = 600;
                                let _ = window.set_position(tauri::PhysicalPosition::new(
                                    x.saturating_sub(w / 2),
                                    y.saturating_sub(h / 20),
                                ));
                            }
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })
            .build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(app.handle())?;
            app.manage(state);

            tray::create_tray(app.handle())?;

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
                crate::paste::check_accessibility_and_log();
            }

            let win = app.get_webview_window("main").unwrap();
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    // Debounce focus-loss auto-hide so native popups opened by
                    // HTML form widgets (select dropdowns on Linux GTK and
                    // Windows, color pickers, file inputs) have time to come
                    // up before we tear the parent window down. Without this
                    // grace period, clicking a <select> opens the GTK popup,
                    // which steals focus from the webview, which fires
                    // Focused(false), which hides the window and destroys
                    // the popup before the user can pick an option. 150ms
                    // is well under the typical user "click away" reaction
                    // time but long enough for the native popup to mount.
                    let win = win_clone.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        if win.is_visible().unwrap_or(false)
                            && !win.is_focused().unwrap_or(false)
                        {
                            let _ = win.hide();
                        }
                    });
                }
            });

            let clip_handle = app.handle().clone();
            std::thread::spawn(move || {
                clipboard::start_monitoring(clip_handle);
            });

            let expire_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                    if let Some(state) = expire_handle.try_state::<AppState>() {
                        if let Ok(db) = state.db.lock() {
                            if let Ok(count) = db.expire_old_items(30) {
                                if count > 0 {
                                    log::info!("Expired {} old clipboard items", count);
                                }
                            }
                        }
                    }
                }
            });

            app.global_shortcut().register("Alt+Shift+V")?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::items::get_items,
            commands::items::search_items,
            commands::items::delete_item,
            commands::items::clear_history,
            commands::items::get_item_by_id,
            commands::items::toggle_favorite,
            commands::items::get_favorites,
            commands::items::paste_item,
            commands::items::undo_delete,
            commands::categories::create_category,
            commands::categories::rename_category,
            commands::categories::delete_category,
            commands::categories::list_categories,
            commands::categories::assign_category,
            commands::categories::remove_category,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::stats::get_stats,
            commands::window::show_window,
            commands::window::hide_window,
            commands::window::toggle_window,
            commands::app::get_version,
            commands::app::get_platform,
            commands::app::get_session_type,
            commands::app::log_to_rust,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
