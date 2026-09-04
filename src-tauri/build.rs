/// 执行 Tauri 构建期配置生成
fn main() {
    tauri_build::build()

    // ONNX Runtime 预编译库使用动态 MSVC C++ 运行库，需要屏蔽静态运行库的默认链接
    #[cfg(target_env = "msvc")]
    configure_dynamic_msvc_runtime()
}

/// 统一 Windows 链接器使用的 C++ 运行库，避免 ONNX Runtime 触发 LNK2038
#[cfg(target_env = "msvc")]
fn configure_dynamic_msvc_runtime() {
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcmt")
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcpmt")
    println!("cargo:rustc-link-arg=/DEFAULTLIB:msvcprt")
}
