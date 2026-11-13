fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    println!("cargo:rerun-if-env-changed=ULTRA_LIBMPV_PREFIX");
    println!("cargo:rerun-if-changed=build.rs");
    if target_os == "macos" {
        macos(&manifest);
    } else if target_os == "windows" {
        windows(&manifest);
    }
    tauri_build::build()
}

/**
 * libmpv on the Mac: the bundled LGPL build (scripts/desktop-libmpv.mjs), linked here and copied
 * into the app's Frameworks folder by the bundler; and the native video view. ULTRA_LIBMPV_PREFIX
 * points elsewhere (e.g. Homebrew's) for experiments.
 */
fn macos(manifest: &str) {
    let vendored = format!("{manifest}/vendor/libmpv");
    let mpv_prefix = std::env::var("ULTRA_LIBMPV_PREFIX").unwrap_or_else(|_| {
        if !std::path::Path::new(&format!("{vendored}/lib/libmpv.dylib")).exists() {
            panic!("libmpv is missing: run `node scripts/desktop-libmpv.mjs` first");
        }
        vendored.clone()
    });
    println!("cargo:rerun-if-changed=native/mpv_view.m");
    println!("cargo:rerun-if-changed=vendor/libmpv/VERSION");
    println!("cargo:rustc-link-search=native={mpv_prefix}/lib");
    println!("cargo:rustc-link-lib=dylib=mpv");
    // Inside the app, Tauri's own rpath finds Contents/Frameworks. Debug builds, run straight from
    // target/, also look in the vendor folder; release builds never point outside the app.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{mpv_prefix}/lib");
    }
    cc::Build::new()
        .file("native/mpv_view.m")
        .flag("-fobjc-arc")
        .flag("-Wno-deprecated-declarations")
        .include(format!("{mpv_prefix}/include"))
        .compile("ultra_mpv_view");
    for framework in ["Cocoa", "QuartzCore", "OpenGL"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

/**
 * libmpv on Windows: one DLL (scripts/desktop-libmpv.mjs --windows), loaded when the app starts.
 * The installer puts it next to the program (tauri.windows.conf.json); for runs straight from
 * target/ it is copied there too.
 */
fn windows(manifest: &str) {
    let dll = std::path::Path::new(manifest).join("vendor/libmpv-win/libmpv-2.dll");
    println!("cargo:rerun-if-changed=vendor/libmpv-win/VERSION");
    if !dll.exists() {
        println!("cargo:warning=libmpv-2.dll is missing: run `node scripts/desktop-libmpv.mjs --windows` first");
        return;
    }
    // OUT_DIR is target/<triple?>/<profile>/build/<crate>/out: the program sits three levels up.
    if let Ok(out) = std::env::var("OUT_DIR") {
        if let Some(profile_dir) = std::path::Path::new(&out).ancestors().nth(3) {
            let _ = std::fs::copy(&dll, profile_dir.join("libmpv-2.dll"));
        }
    }
}
