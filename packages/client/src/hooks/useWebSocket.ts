import { useSyncExternalStore, useCallback, useRef, useEffect } from "react";
import {
  MsgType,
  type WsMessage,
  type PlayerAssignedPayload,
  type RoomInfoPayload,
  type StatePayload,
  type TimerPayload,
  type MovePayload,
  type SerializedState,
  Player,
} from "@connect6/shared";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface WebSocketState {
  status: ConnectionStatus;
  playerColor: Player.BLACK | Player.WHITE | null;
  roomInfo: RoomInfoPayload | null;
  lastState: StatePayload | null;
  timer: TimerPayload | null;
  pendingReset: boolean; // other player requested a reset
  error: string | null;
}

const initialState: WebSocketState = {
  status: "disconnected",
  playerColor: null,
  roomInfo: null,
  lastState: null,
  timer: null,
  pendingReset: false,
  error: null,
};

// Module-level singleton state
let state: WebSocketState = { ...initialState };
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const listeners = new Set<() => void>();

// Callbacks for external consumers (game store)
let onStateUpdate: ((state: StatePayload) => void) | null = null;
let onGameStart: ((state: SerializedState) => void) | null = null;

function emit() {
  for (const l of listeners) l();
}

function setState(partial: Partial<WebSocketState>) {
  state = { ...state, ...partial };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return state;
}

function connect(url: string) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setState({ status: "connecting", error: null });
  reconnectAttempts = 0;
  doConnect(url);
}

function doConnect(url: string) {
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setState({ status: "disconnected", error: "Failed to create WebSocket" });
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    setState({ status: "connected", error: null });
    // Auto-join on connect
    ws!.send(JSON.stringify({ type: MsgType.JOIN, payload: {} }));
  };

  ws.onmessage = (event) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (msg.type) {
      case MsgType.PLAYER_ASSIGNED: {
        const payload = msg.payload as PlayerAssignedPayload;
        setState({ playerColor: payload.color });
        break;
      }
      case MsgType.ROOM_INFO: {
        const payload = msg.payload as RoomInfoPayload;
        setState({ roomInfo: payload });
        if (onGameStart) onGameStart(payload.state);
        break;
      }
      case MsgType.STATE: {
        const payload = msg.payload as StatePayload;
        setState({ lastState: payload });
        if (onStateUpdate) onStateUpdate(payload);
        break;
      }
      case MsgType.ERROR: {
        setState({ error: msg.payload as string });
        break;
      }
      case MsgType.GAME_OVER: {
        break;
      }
      case MsgType.TIMER: {
        setState({ timer: msg.payload as TimerPayload });
        break;
      }
      case MsgType.RESET_REQUEST: {
        setState({ pendingReset: true });
        break;
      }
      case MsgType.RESET_ACK: {
        setState({ pendingReset: false });
        break;
      }
    }
  };

  ws.onclose = () => {
    setState({ status: "disconnected" });
    ws = null;
    // Auto-reconnect
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => doConnect(url), delay);
    }
  };

  ws.onerror = () => {
    setState({ error: "Connection error" });
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
  if (ws) {
    ws.close();
    ws = null;
  }
  setState({ ...initialState });
}

function sendMove(x: number, y: number, z: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload: MovePayload = { x, y, z };
  ws.send(JSON.stringify({ type: MsgType.MOVE, payload }));
}

function sendJoin() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MsgType.JOIN, payload: {} }));
}

function sendResetRequest() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MsgType.RESET_REQUEST, payload: {} }));
}

function sendResetConfirm() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MsgType.RESET_CONFIRM, payload: {} }));
}

/** Register callback for state updates from server */
function setOnStateUpdate(cb: ((state: StatePayload) => void) | null) {
  onStateUpdate = cb;
}

/** Register callback for game start (initial snapshot) */
function setOnGameStart(cb: ((state: SerializedState) => void) | null) {
  onGameStart = cb;
}

// ─── React hooks ───

export function useWebSocketState(): WebSocketState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useWebSocketActions() {
  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);
  const sendMoveRef = useRef(sendMove);
  const sendJoinRef = useRef(sendJoin);
  const sendResetRequestRef = useRef(sendResetRequest);
  const sendResetConfirmRef = useRef(sendResetConfirm);
  const setOnStateUpdateRef = useRef(setOnStateUpdate);
  const setOnGameStartRef = useRef(setOnGameStart);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnectRef.current(); };
  }, []);

  return {
    connect: connectRef.current,
    disconnect: disconnectRef.current,
    sendMove: sendMoveRef.current,
    sendJoin: sendJoinRef.current,
    sendResetRequest: sendResetRequestRef.current,
    sendResetConfirm: sendResetConfirmRef.current,
    setOnStateUpdate: setOnStateUpdateRef.current,
    setOnGameStart: setOnGameStartRef.current,
  };
}
