# 声屿前端

这是独立的 React/Vite + Tauri 2 桌面客户端项目，支持 macOS 与 Windows

```bash
npm install
npm run tauri dev
```

网页端使用 1Panel 的 HTTPS 入口 `https://82.157.174.249:8004`，Tauri 客户端使用服务器的 HTTP 与 WebSocket 端口连接

跨机器运行时，可以设置 `VITE_TOKEN_URL` 和 `VITE_LIVEKIT_URL`

```bash
VITE_TOKEN_URL=/api/token \
VITE_LIVEKIT_URL=wss://服务器地址:8004 \
VITE_TAURI_TOKEN_URL=http://服务器地址:8787/api/token \
VITE_TAURI_LIVEKIT_URL=ws://服务器地址:7880 \
npm run tauri dev
```

## GitHub 自动打包与更新

推送版本标签后，GitHub Actions 会为 macOS、Windows 和 Linux 生成安装包并发布 Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

仓库需要配置以下 Actions Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：Tauri 更新签名私钥

客户端启动后会读取 GitHub 最新 Release 的 `latest.json`，检测到新版本时询问用户并自动安装

Windows 使用 WebView2 运行界面，首次使用麦克风时由系统请求权限；更新安装使用被动模式并显示安装进度
