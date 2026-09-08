import MakerNSIS from '@electron-addons/electron-forge-maker-nsis'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'node:path'

const nativePlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
const nativeResourcePath = path.join(__dirname, 'native', 'resources', nativePlatform, process.arch)
const electronZipDir = process.env.ELECTRON_ZIP_DIR

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: '声屿',
    appBundleId: 'com.voiceisland.app',
    extraResource: [nativeResourcePath],
    // 本地可指定已缓存的 Electron ZIP，CI 未设置时仍由 Forge 正常下载
    ...(electronZipDir ? { electronZipDir } : {}),
    // 使用旧项目确认过的图标资源，确保应用和安装程序使用同一套 Windows 图标
    icon: './assets/icon'
  },
  rebuildConfig: {},
  makers: [
    new MakerNSIS({
      updater: {
        url: 'https://githubdog.com/https://github.com/LZW0506/voice-room/releases/latest/download',
        channel: 'latest',
        updaterCacheDirName: 'voice-island-updater'
      }
    })
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }]
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
}

export default config
