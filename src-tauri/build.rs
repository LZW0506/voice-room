/// 执行 Tauri 构建期配置生成
fn main() {
    tauri_build::build();

    // WebRTC 预编译库使用静态 MSVC C++ 运行库，ONNX Runtime 使用动态运行库
    // 屏蔽静态运行库可以避免 RuntimeLibrary 冲突，再将 WebRTC 使用的带 size 参数 delete 映射到动态运行库实现
    #[cfg(target_env = "msvc")]
    configure_dynamic_msvc_runtime()
}

/// 配置 Windows 链接器兼容 WebRTC 与 ONNX Runtime 的不同 MSVC 运行库
#[cfg(target_env = "msvc")]
fn configure_dynamic_msvc_runtime() {
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcmt");
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:libcpmt");
    println!("cargo:rustc-link-arg=/DEFAULTLIB:msvcprt");

    // WebRTC 的静态库引用 C++14 sized delete，而动态 MSVC 运行库只保证无 size 的实现
    // 使用链接器备用名称让这两个符号复用同一套动态运行库，避免引入 libcpmt 再次触发 LNK2038
    println!("cargo:rustc-link-arg=/alternatename:??3@YAXPEAX_K@Z=??3@YAXPEAX@Z");
    println!("cargo:rustc-link-arg=/alternatename:??_V@YAXPEAX_K@Z=??_V@YAXPEAX@Z");
}
