/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the deployed chat Worker, e.g. https://funding-explorer.example.workers.dev */
  readonly VITE_API_URL?: string;
  /** Neon Auth base URL, e.g. https://ep-xxx.neonauth.<region>.aws.neon.tech/neondb/auth */
  readonly VITE_NEON_AUTH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
