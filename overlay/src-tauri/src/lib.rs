use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use device_query::{DeviceQuery, DeviceState};

#[derive(Default, Clone, Serialize, Deserialize, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Default, Clone, Serialize, Deserialize, Debug)]
pub struct InteractiveState {
    pub regions: Vec<Rect>,
    pub is_hovered: bool,
    pub is_typing: bool,
    pub is_dragging: bool,
    pub is_modal_active: bool,
}

pub struct AppState {
    pub interactive_state: Arc<Mutex<InteractiveState>>,
    pub force_interactive: Arc<Mutex<bool>>,
    pub currently_ignoring: Arc<Mutex<bool>>,
}

/// Fast command to toggle hover mode over HUD elements
#[tauri::command]
fn set_hover_mode(state: State<'_, AppState>, hovered: bool) {
    if let Ok(mut s) = state.interactive_state.lock() {
        s.is_hovered = hovered;
    }
}

/// Fast command to toggle dragging mode
#[tauri::command]
fn set_dragging_mode(state: State<'_, AppState>, dragging: bool) {
    if let Ok(mut s) = state.interactive_state.lock() {
        s.is_dragging = dragging;
    }
}

/// Fast command to toggle modal active mode (e.g. diagram or approval open)
#[tauri::command]
fn set_modal_mode(state: State<'_, AppState>, active: bool) {
    if let Ok(mut s) = state.interactive_state.lock() {
        s.is_modal_active = active;
    }
}

/// Tauri command to update multiple interactive bounding boxes and states
#[tauri::command]
fn update_interactive_regions(
    state: State<'_, AppState>,
    regions: Vec<Rect>,
    is_typing: bool,
    is_dragging: bool,
    is_modal_active: bool,
) {
    if let Ok(mut s) = state.interactive_state.lock() {
        s.regions = regions;
        s.is_typing = is_typing;
        s.is_dragging = is_dragging;
        s.is_modal_active = is_modal_active;
    }
}

/// Backward compatible command for single HUD pill bounds
#[tauri::command]
fn update_hud_bounds(
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    is_typing: bool,
) {
    if let Ok(mut s) = state.interactive_state.lock() {
        s.regions = vec![Rect { x, y, width, height }];
        s.is_typing = is_typing;
    }
}

/// Query connected monitors for multi-display teleportation and layout
#[tauri::command]
fn get_available_monitors(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(monitors) = window.available_monitors() {
            return monitors
                .iter()
                .enumerate()
                .map(|(idx, m)| {
                    serde_json::json!({
                        "index": idx,
                        "name": m.name().cloned().unwrap_or_else(|| format!("Display {}", idx + 1)),
                        "x": m.position().x,
                        "y": m.position().y,
                        "width": m.size().width,
                        "height": m.size().height,
                        "scale_factor": m.scale_factor()
                    })
                })
                .collect();
        }
    }
    vec![]
}

/// Closes the application completely and terminates the process
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Minimizes the main overlay window
#[tauri::command]
fn minimize_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let interactive_state = Arc::new(Mutex::new(InteractiveState {
        regions: vec![],
        is_hovered: false,
        is_typing: false,
        is_dragging: false,
        is_modal_active: false,
    }));
    let force_interactive = Arc::new(Mutex::new(false));
    let currently_ignoring = Arc::new(Mutex::new(true));

    let app_state = AppState {
        interactive_state: interactive_state.clone(),
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
        .invoke_handler(tauri::generate_handler![
            update_interactive_regions,
            update_hud_bounds,
            set_dragging_mode,
            set_modal_mode,
            set_hover_mode,
            get_available_monitors,
            exit_app,
            minimize_window
        ])
        .setup(move |app| {
            // Register Alt+Space shortcut globally
            let _ = app.global_shortcut().register(alt_space_shortcut);

            let main_window = app
                .get_webview_window("main")
                .expect("Failed to get main webview window");

            // Explicitly strip any Windows DWM title bar decorations or drop-shadows
            let _ = main_window.set_decorations(false);
            let _ = main_window.set_shadow(false);
            let _ = main_window.set_always_on_top(true);
            let _ = main_window.set_fullscreen(false);

            // Span entire multi-monitor virtual desktop across all connected screens
            if let Ok(monitors) = main_window.available_monitors() {
                if !monitors.is_empty() {
                    let min_x = monitors.iter().map(|m| m.position().x).min().unwrap_or(0);
                    let min_y = monitors.iter().map(|m| m.position().y).min().unwrap_or(0);
                    let max_x = monitors.iter().map(|m| m.position().x + m.size().width as i32).max().unwrap_or(1920);
                    let max_y = monitors.iter().map(|m| m.position().y + m.size().height as i32).max().unwrap_or(1080);
                    let total_width = (max_x - min_x).max(800) as u32;
                    let total_height = (max_y - min_y).max(600) as u32;

                    let _ = main_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(min_x, min_y)));
                    let _ = main_window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(total_width, total_height)));
                } else {
                    let _ = main_window.maximize();
                }
            } else {
                let _ = main_window.maximize();
            }

            // Set initial mode to click-through so auto-hide taskbar and underlying apps work immediately
            let _ = main_window.set_ignore_cursor_events(true);

            // Spawn lightweight background cursor-position polling loop (Method B)
            // 30ms sleep per tick guarantees instant responsiveness with 0% CPU overhead
            let window_clone = main_window.clone();
            let state_clone = interactive_state.clone();
            let force_clone = force_interactive.clone();
            let ignoring_clone = currently_ignoring.clone();

            thread::spawn(move || {
                let device_state = DeviceState::new();
                let mut monitor_bounds: Vec<(i32, i32, i32, i32)> = Vec::new();
                let mut last_monitor_check = std::time::Instant::now() - Duration::from_secs(10);

                loop {
                    thread::sleep(Duration::from_millis(30));

                    // Periodically refresh monitor boundaries (every 3 seconds)
                    if last_monitor_check.elapsed() > Duration::from_secs(3) {
                        if let Ok(monitors) = window_clone.available_monitors() {
                            monitor_bounds = monitors.iter().map(|m| {
                                let pos = m.position();
                                let size = m.size();
                                (pos.x, pos.y, pos.x + size.width as i32, pos.y + size.height as i32)
                            }).collect();
                        }
                        last_monitor_check = std::time::Instant::now();
                    }

                    let force = *force_clone.lock().unwrap_or_else(|e| e.into_inner());
                    let state = state_clone.lock().unwrap_or_else(|e| e.into_inner()).clone();
                    let mut is_ignoring = ignoring_clone.lock().unwrap_or_else(|e| e.into_inner());

                    let mouse = device_state.get_mouse();
                    let (cx, cy) = mouse.coords;

                    // Windows Auto-Hide Taskbar Guard:
                    // If the cursor is at the bottom edge (bottom 10px) of ANY screen and the user is NOT dragging,
                    // immediately release cursor events so Windows Explorer detects mouse hover and un-hides the taskbar!
                    let is_at_taskbar_edge = monitor_bounds.iter().any(|&(x1, _y1, x2, y2)| {
                        cx >= x1 && cx <= x2 && cy >= (y2 - 12) && cy <= (y2 + 8)
                    });

                    // Apply a 16px interactive comfort margin around each registered bounding region
                    let inside_any_region = state.regions.iter().any(|r| {
                        cx >= (r.x - 16) && cx <= (r.x + r.width + 16) && cy >= (r.y - 16) && cy <= (r.y + r.height + 16)
                    });

                    let is_left_mouse_down = mouse.button_pressed.get(1).copied().unwrap_or(false);

                    let should_interact = if is_at_taskbar_edge && !state.is_dragging {
                        false
                    } else {
                        inside_any_region
                            || state.is_hovered
                            || state.is_dragging
                            || state.is_modal_active
                            || (is_left_mouse_down && inside_any_region)
                            || force
                    };

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

