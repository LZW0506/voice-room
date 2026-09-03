/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TOKEN_URL?: string
  readonly VITE_LIVEKIT_URL?: string
  readonly VITE_TAURI_TOKEN_URL?: string
  readonly VITE_TAURI_LIVEKIT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
