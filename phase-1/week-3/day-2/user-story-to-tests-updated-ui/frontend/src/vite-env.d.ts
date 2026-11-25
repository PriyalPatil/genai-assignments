/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** Predefined login credentials for the Login page */
  readonly VITE_LOGIN_USERNAME?: string
  readonly VITE_LOGIN_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}