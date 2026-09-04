# 声屿前端

这是独立的 React/Vite + Tauri 2 桌面客户端项目，仅发布 macOS 与 Windows 安装包

```bash
npm install
npm run tauri dev
```

客户端直接连接服务器的 Gin Token 服务与 LiveKit 服务

跨机器运行时，可以设置 `VITE_TOKEN_URL` 和 `VITE_LIVEKIT_URL`

```bash
VITE_TOKEN_URL=http://82.157.174.249:8787/api/token \
VITE_LIVEKIT_URL=ws://82.157.174.249:7880 \
npm run tauri dev
```

## GitHub 自动打包与更新

推送 `app-v` 开头的版本标签后，GitHub Actions 会生成 macOS Universal DMG 与 Windows x64 NSIS 安装包并发布 Release：

```bash
git tag app-v0.1.0
git push origin app-v0.1.0
```

仓库需要配置以下 Actions Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：Tauri 更新签名私钥

客户端启动后会读取 GitHub 最新 Release 的 `latest.json`，检测到新版本时询问用户并自动安装

Windows 使用 WebView2 运行界面，首次使用麦克风时由系统请求权限；更新安装使用被动模式并显示安装进度
