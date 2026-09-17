#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // First, before anything else: on Windows and Linux the system answers a
    // lorehaven:// link by starting a second copy of the app with the link as
    // an argument. This hands that link to the copy already running -- with the
    // deep-link feature it arrives through onOpenUrl like any other -- brings
    // its window forward, and lets the second copy exit.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        // lorehaven:// links, which is how a Steam sign-in finished in the
        // system browser comes back to the app.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // The installers register the scheme on Windows and macOS. A Linux
            // AppImage has no installer, and a Windows development build is
            // never installed, so both register it themselves at start-up.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
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
