# 声屿

声屿是基于 Electron、React、LiveKit 和 WebRTC 开发的 Windows x64 桌面语音房间

## 开发环境

- Windows 10 或 Windows 11 x64
- Node.js 22
- Yarn 1.x

安装依赖并启动开发环境：

```bash
yarn install
yarn start
```

## 环境变量

- `VITE_TOKEN_URL`：房间 Token 服务地址
- `VITE_LIVEKIT_URL`：Token 服务未返回地址时使用的 LiveKit 地址
- `VITE_UPDATE_URL`：Squirrel.Windows 更新源地址

## 构建

生成可运行的 Windows x64 应用目录：

```bash
yarn build
```

生成 Squirrel.Windows 安装包、`RELEASES` 和 NuGet 包：

```bash
yarn make --arch=x64
```

构建产物位于 `out/make/squirrel.windows/x64`

## 自动发布

推送格式为 `app-v*` 的标签后，GitHub Actions 会在 Windows runner 上构建并上传以下文件：

- `VoiceIsland-Setup.exe`
- `RELEASES`
- `.nupkg` 更新包

Squirrel.Windows 使用 `RELEASES` 协议检查和安装更新，不生成 `latest.yml`
