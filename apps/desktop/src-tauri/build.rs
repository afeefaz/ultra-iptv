fn main() {
    // libmpv: the bundled LGPL build (scripts/desktop-libmpv.mjs), copied into the app's Frameworks
    // folder by the bundler. ULTRA_LIBMPV_PREFIX points elsewhere (e.g. Homebrew's) for experiments.
    let vendored = format!(
        "{}/vendor/libmpv",
        std::env::var("CARGO_MANIFEST_DIR").unwrap()
    );
    let mpv_prefix = std::env::var("ULTRA_LIBMPV_PREFIX").unwrap_or_else(|_| {
        if !std::path::Path::new(&format!("{vendored}/lib/libmpv.dylib")).exists() {
            panic!("libmpv is missing: run `node scripts/desktop-libmpv.mjs` first");
        }
        vendored.clone()
    });
    println!("cargo:rerun-if-env-changed=ULTRA_LIBMPV_PREFIX");
    println!("cargo:rerun-if-changed=native/mpv_view.m");
    println!("cargo:rerun-if-changed=build.rs");
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
    tauri_build::build()
}
