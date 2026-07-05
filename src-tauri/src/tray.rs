use tauri::{
    AppHandle, Manager,
    tray::{TrayIconBuilder, TrayIconEvent},
    menu::{MenuBuilder, MenuItemBuilder},
    Emitter,
};

pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_history = MenuItemBuilder::with_id("open_history", "Open History").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let about = MenuItemBuilder::with_id("about", "About").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_history)
        .item(&settings)
        .separator()
        .item(&about)
        .separator()
        .item(&quit)
        .build()?;

    let icon = {
        let _img_bytes = include_bytes!("../icons/32x32.png");
        let rgba = vec![0u8; 32 * 32 * 4];
        tauri::image::Image::new_owned(rgba, 32, 32)
    };

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open_history" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("navigate", "settings");
                    }
                }
                "about" => {
                    let _ = app.emit("show-about", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up, ..
            } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
