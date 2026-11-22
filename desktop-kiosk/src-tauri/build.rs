fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/macos_print.m")
            .flag("-fobjc-arc")
            .compile("macos_print");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=PDFKit");
    }

    tauri_build::build();
}
