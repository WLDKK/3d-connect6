import type { SerializedState } from "./engine";

/** A 3D coordinate on the board */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Which player owns a cell */
export enum Stone {
  EMPTY = 0,
  BLACK = 1,
  WHITE = 2,
}

/** Whose turn it is */
export enum Player {
  BLACK = Stone.BLACK,
  WHITE = Stone.WHITE,
}

/** Dynamic board dimensions (defaults to 6x6x6) */
export interface BoardConfig {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  winLength: number; // consecutive stones to win (default 6)
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  sizeX: 10,
  sizeY: 10,
  sizeZ: 10,
  winLength: 6,
};

/** Full game state — a flat 3D tensor stored as a 1D array for zero-copy snapshots */
export interface GameState {
  config: BoardConfig;
  /** Flattened 3D tensor: index = z * sizeY * sizeX + y * sizeX + x */
  board: Uint8Array;
  currentPlayer: Player;
  /** 0 = round 0 (black places 1 stone), 1+ = normal rounds (2 stones each) */
  round: number;
  /** Stones placed by current player this turn (0, 1, or 2) */
  stonesPlacedThisTurn: number;
  winner: Stone.EMPTY | Player;
  moves: Vec3[];
}

/** A single Connect6 direction vector (one of 13 basis directions) */
export type Direction = Vec3;

/** Message types exchanged over WebSocket */
export enum MsgType {
  JOIN = "join",
  MOVE = "move",
  STATE = "state",
  ERROR = "error",
  GAME_OVER = "game_over",
  PLAYER_ASSIGNED = "player_assigned",
  ROOM_INFO = "room_info",
  TIMER = "timer",
  RESET_REQUEST = "reset_request",
  RESET_CONFIRM = "reset_confirm",
  RESET_ACK = "reset_ack",
  READY = "ready",
  GAME_START = "game_start",
}

export interface WsMessage<T = unknown> {
  type: MsgType;
  payload: T;
}

export interface MovePayload {
  x: number;
  y: number;
  z: number;
}

export interface StatePayload {
  board: number[]; // serialized board for transport
  currentPlayer: Player;
  round: number;
  stonesPlacedThisTurn: number;
  winner: Stone.EMPTY | Player;
  lastMove?: Vec3;
}

export interface PlayerAssignedPayload {
  color: Player;
}

export interface RoomInfoPayload {
  players: { black: boolean; white: boolean };
  state: SerializedState;
}

export interface TimerPayload {
  currentPlayer: Player;
  remainingMs: number;
  turnStartTime: number;
}

export interface ResetRequestPayload {
  /** Which player initiated the reset */
  initiator: Player;
}

export interface ResetAckPayload {
  /** true = reset executed, false = cancelled */
  success: boolean;
}

// ─── AI Interface Contract ───

/** Available AI model identifiers */
export type AiModelId =
  | "local"          // Local Dummy AI (greedy defense, no network)
  | "qwen3.6-plus"   // Qwen 3.6 Plus (OpenAI protocol)
  | "qwen3.7-max"    // Qwen 3.7 Max (Anthropic protocol)
  | "deepseek-v4-flash" // DeepSeek V4 Flash (Anthropic protocol)
  | "glm-5.1";       // GLM 5.1 (Anthropic protocol)

/** Human player color choice */
export type ColorChoice = "black" | "white" | "random";

/** Request payload sent to AI inference endpoint */
export interface AiRequestPayload {
  /** Flat tensor array: board[z*sizeY*sizeX + y*sizeX + x] */
  board: number[];
  config: BoardConfig;
  /** Which player the AI is playing as */
  aiColor: Player;
  /** Whose turn it is now */
  currentPlayer: Player;
  /** Number of stones the current player must place this turn */
  stonesToPlace: number;
  /** Which AI model to use (default: "local") */
  model?: AiModelId;
}

/** Response payload returned by AI */
export interface AiResponsePayload {
  /** Optimal moves the AI wants to make (1 or 2 coords) */
  moves: Vec3[];
}
