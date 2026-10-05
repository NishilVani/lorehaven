//! The app's own Android code: LoreHavenPlugin.kt in the app module
//! (gen/android/app/src/main/java/com/lorehaven/games/).
//!
//! A plugin's commands are checked against capability files, and a plugin
//! defined inside the app has none, so the web code cannot call the Kotlin
//! class directly. It calls `native_call` instead, an app command (the app has
//! no ACL manifest, so app commands are open to the app's own pages and closed
//! to remote ones), which forwards only the methods named below.

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Every Kotlin method the web code may reach. Anything else is refused.
const METHODS: &[&str] = &[
    "setWidgetData",
    "setWallpaper",
    "takeShared",
    "setBackIntercept",
    "moveToBack",
    "setSystemBars",
    "canPinWidgets",
    "pinWidget",
];

pub struct Native<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lorehaven")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.lorehaven.games", "LoreHavenPlugin")?;
            app.manage(Native(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn native_call<R: Runtime>(
    app: AppHandle<R>,
    method: String,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !METHODS.contains(&method.as_str()) {
        return Err(format!("{method} is not a native method"));
    }
    let args = args.unwrap_or_else(|| serde_json::json!({}));
    /* run_mobile_plugin blocks until Kotlin resolves, and setWallpaper waits
       on a download, so keep it off the async workers. */
    tauri::async_runtime::spawn_blocking(move || {
        let native = app.state::<Native<R>>();
        native
            .0
            .run_mobile_plugin::<serde_json::Value>(&method, args)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
