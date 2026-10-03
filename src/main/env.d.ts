/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_CURSEFORGE_API_KEY?: string
  readonly MAIN_VITE_MSA_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
