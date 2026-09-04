// 为 WebRTC 静态库提供动态 MSVC 运行库缺少的 sized delete 入口
#include <cstddef>

/// 将带 size 参数的释放请求转发给动态运行库的基础实现
void operator delete(void* pointer, std::size_t) noexcept {
    ::operator delete(pointer);
}

/// 将数组带 size 参数的释放请求转发给动态运行库的基础实现
void operator delete[](void* pointer, std::size_t) noexcept {
    ::operator delete[](pointer);
}
