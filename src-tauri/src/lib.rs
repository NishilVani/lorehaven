#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init());

    // Shared storage (Pictures/, Download/) is a MediaStore concept, so this
    // plugin exists only on Android and the crate is not compiled elsewhere.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
