fn main() {
    // tauri_build embeds icons/icon.ico into the executable as a Windows
    // resource, but emits cargo:rerun-if-changed only for tauri.conf.json,
    // resources and capabilities -- never for the icon itself. Without this
    // line Cargo never learns the icon changed, skips re-running this script,
    // links the cached resource.lib, and the freshly built binary still shows
    // the previous icon. Replacing icons/ alone is not enough.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
