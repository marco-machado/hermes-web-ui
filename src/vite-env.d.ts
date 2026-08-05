/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HERMES_HOST?: string
  readonly VITE_HERMES_PORT?: string
  readonly VITE_HERMES_TOKEN?: string
  readonly VITE_HERMES_CWD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
