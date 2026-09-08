# Repository Guidelines

## 项目结构

- `src/main/`：Electron 主进程、窗口管理和 IPC
- `src/preload/`：安全的主进程桥接接口
- `src/renderer/`：React 页面、设置页、状态和音频链路
- `native/noise-reduction/`：Rust 原生降噪 helper 与 ONNX Runtime 推理
- `scripts/`：模型、helper 资源准备和本地 PCM 测试脚本
- `assets/`：应用图标等静态资源

## 开发、构建与验证

```bash
yarn install                  # 安装依赖
yarn start                    # 启动 Electron 开发环境
yarn lint                     # 执行 ESLint
yarn tsc --noEmit             # 执行 TypeScript 类型检查
yarn native:prepare           # 准备当前系统和架构的模型与 helper
yarn native:test              # 验证 helper 的 PCM 输入输出
yarn build                    # 类型检查并打包当前平台应用
```

`native:prepare` 只生成当前构建环境的资源目录，例如 macOS arm64 为 `native/resources/macos/arm64/`，Windows x64 为 `native/resources/windows/x64/`。资源目录和 Rust `target/` 不应提交。网络受限时可设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或 `PROXY_URL` 为 `http://127.0.0.1:7890`，也可用 `DEEPFILTER_MODEL_PATH` 指定本地模型

## 音频方案

Windows 和 macOS 均支持关闭、WebRTC、DeepFilterNet（ONNX Runtime CPU），默认使用 CPU 方案。WebRTC 通过 `getUserMedia({ noiseSuppression: true })` 工作；CPU 方案关闭浏览器降噪，经 AudioWorklet 和 helper 处理后再发布到 LiveKit。方案互斥，回声抵消可独立启用。当前 helper 协议为 48kHz、单声道、Float32 little-endian、480 samples 一帧

## 编码与测试规范

TypeScript/React 使用 2 空格缩进，遵循 ESLint 和 Prettier，组件使用 PascalCase，函数和变量使用 camelCase。新增方法、实体及复杂逻辑需要中文注释，注释结尾不要使用中文句号。提交前至少运行 `yarn lint`、`yarn tsc --noEmit` 和 `yarn native:test`

## 提交与 Pull Request

提交信息使用 Conventional Commits，例如 `feat:`、`fix:`、`chore:`。PR 需要说明行为变化、验证命令和平台影响；涉及设置页或音频链路时补充界面截图及测试平台。不要提交密钥、模型临时文件、`native/resources/`、Rust `target/` 或 `out/`
