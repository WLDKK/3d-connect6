/**
 * Shared configuration constants.
 */

/** Multiplayer Worker base URL. VITE_API_URL is retained for deploy compatibility. */
const SERVER_BASE = import.meta.env.VITE_API_URL
  || (location.hostname.includes("pages.dev")
    ? "https://connect6-server.1310205058.workers.dev"
    : "");

/** WebSocket base URL for multiplayer rooms. */
export const WS_BASE = SERVER_BASE
  ? SERVER_BASE.replace(/^http/, "ws")
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
