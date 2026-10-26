use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use device_query::{DeviceQuery, DeviceState};

#[derive(Default, Clone, Copy, Debug)]
pub struct HudBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_typing: bool,
}

pub struct AppState {
    pub hud_bounds: Arc<Mutex<HudBounds>>,
    pub force_interactive: Arc<Mutex<bool>>,
    pub currently_ignoring: Arc<Mutex<bool>>,
}

/// Tauri command to update HUD bounding box rectangle and typing state from frontend
#[tauri::command]
fn update_hud_bounds(
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    is_typing: bool,
) {
    if let Ok(mut bounds) = state.hud_bounds.lock() {
        bounds.x = x;
        bounds.y = y;
        bounds.width = width;
        bounds.height = height;
        bounds.is_typing = is_typing;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hud_bounds = Arc::new(Mutex::new(HudBounds::default()));
    let force_interactive = Arc::new(Mutex::new(false));
    let currently_ignoring = Arc::new(Mutex::new(true));

    let app_state = AppState {
        hud_bounds: hud_bounds.clone(),
        force_interactive: force_interactive.clone(),
        currently_ignoring: currently_ignoring.clone(),
    };

    let alt_space_shortcut: Shortcut = "Alt+Space".parse().expect("Failed to parse Alt+Space shortcut");

    let force_toggle_clone = force_interactive.clone();
    let ignoring_toggle_clone = currently_ignoring.clone();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app_handle, shortcut, event| {
                    if shortcut == &alt_space_shortcut && event.state() == ShortcutState::Pressed {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let mut force = force_toggle_clone.lock().unwrap();
                            *force = !*force;

                            if *force {
                                // Enable interaction, focus window, and focus command input
                                let _ = window.set_ignore_cursor_events(false);
                                let _ = window.set_focus();
                                let mut ign = ignoring_toggle_clone.lock().unwrap();
                                *ign = false;
                                let _ = window.emit("vexa-toggle-focus", ());
                            } else {
                                // Disable interaction and return to click-through
                                let _ = window.set_ignore_cursor_events(true);
                                let mut ign = ignoring_toggle_clone.lock().unwrap();
                                *ign = true;
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![update_hud_bounds])
        .setup(move |app| {
            // Register Alt+Space shortcut globally
            let _ = app.global_shortcut().register(alt_space_shortcut);

            let main_window = app
                .get_webview_window("main")
                .expect("Failed to get main webview window");

            // Set initial click-through mode
            let _ = main_window.set_ignore_cursor_events(true);

            // Spawn lightweight background cursor-position polling loop (Method B)
            // 50ms sleep per tick guarantees 0% CPU overhead while maintaining instant responsiveness
            let window_clone = main_window.clone();
            let bounds_clone = hud_bounds.clone();
            let force_clone = force_interactive.clone();
            let ignoring_clone = currently_ignoring.clone();

            thread::spawn(move || {
                let device_state = DeviceState::new();
                loop {
                    thread::sleep(Duration::from_millis(50));

                    let force = *force_clone.lock().unwrap_or_else(|e| e.into_inner());
                    let bounds = *bounds_clone.lock().unwrap_or_else(|e| e.into_inner());
                    let mut is_ignoring = ignoring_clone.lock().unwrap_or_else(|e| e.into_inner());

                    let mouse = device_state.get_mouse();
                    let (cx, cy) = mouse.coords;

                    let inside = cx >= bounds.x
                        && cx <= (bounds.x + bounds.width)
                        && cy >= bounds.y
                        && cy <= (bounds.y + bounds.height);

                    let should_interact = inside || bounds.is_typing || force;

                    if should_interact && *is_ignoring {
                        let _ = window_clone.set_ignore_cursor_events(false);
                        *is_ignoring = false;
                    } else if !should_interact && !*is_ignoring {
                        let _ = window_clone.set_ignore_cursor_events(true);
                        *is_ignoring = true;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running VEXA overlay application");
}
