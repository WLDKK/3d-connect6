/**
 * Shared configuration constants.
 */

/** API base URL for Worker (WebSocket + REST). */
export const API_BASE = import.meta.env.VITE_API_URL
  || (location.hostname.includes("pages.dev")
    ? "https://connect6-server.1310205058.workers.dev"
    : "");

/** WebSocket base URL derived from API_BASE. */
export const WS_BASE = API_BASE
  ? API_BASE.replace(/^http/, "ws")
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
