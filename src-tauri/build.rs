/// 执行 Tauri 构建期配置生成
fn main() {
    tauri_build::build();

    // WebRTC 预编译库使用静态 MSVC C++ 运行库，ONNX Runtime 使用动态运行库
    // 屏蔽静态运行库后由兼容实现补充 WebRTC 需要的 sized delete 符号
    #[cfg(target_env = "msvc")]
    configure_dynamic_msvc_runtime();
}

/// 配置 Windows 链接器兼容 WebRTC 与 ONNX Runtime 的不同 MSVC 运行库
#[cfg(target_env = "msvc")]
fn configure_dynamic_msvc_runtime() {
    // 使用动态 C++ 运行库编译兼容实现，避免重新引入 libcpmt 的重复符号
    cc::Build::new()
        .cpp(true)
        .file("msvc_compat.cpp")
        .flag("/utf-8")
        .warnings(false)
        .compile("msvc-compat");

    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcmt");
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcpmt");
    println!("cargo:rustc-link-arg=/DEFAULTLIB:msvcprt");
}
