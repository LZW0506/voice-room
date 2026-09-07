# 声屿

声屿是基于 Electron、React、LiveKit 和 WebRTC 开发的 Windows x64 桌面语音房间，使用 NSIS 安装器与 electron-updater 自动更新

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
- `VITE_UPDATE_URL`：electron-updater 的 generic 更新目录地址

默认更新源为 GitHub Release 的 `latest.yml` 目录地址，也可以通过 `VITE_UPDATE_URL` 覆盖

## 构建

生成可运行的 Windows x64 应用目录：

```bash
yarn build
```

生成 NSIS 安装包和 electron-updater 更新清单：

```bash
yarn make --arch=x64
```

构建产物位于 `out/make/nsis/x64`

## 自动发布

推送格式为 `app-v*` 的标签后，GitHub Actions 会在 Windows runner 上构建并上传以下文件：

- `voice-island-windows-x64-版本号.exe`
- `latest.yml`
- `.blockmap` 文件

首次安装时 NSIS 向导允许用户选择安装目录，更新时 electron-updater 会复用原安装目录并在下载完成后提示重启安装
