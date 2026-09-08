# 原生降噪资源

`native/noise-reduction` 是独立 PCM helper。协议为 48kHz、单声道、Float32 little-endian，按模型帧长读写标准输入输出

当前 provider 是 `onnx-cpu`，底层使用 DeepFilterNet 官方 ONNX 模型包和 ONNX Runtime CPU 推理，可在 Windows 和 macOS 上构建。DirectML 与 Core ML 暂不包含在当前资源包中

```bash
cd voice-room
corepack yarn native:prepare
corepack yarn native:test
corepack yarn build
```
