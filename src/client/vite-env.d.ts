/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional WebSocket endpoint for a client built for static hosting. */
  readonly VITE_WS_URL?: string;
}
