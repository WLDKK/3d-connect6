import { useSyncExternalStore, useCallback } from "react";
import { type SerializedState, Stone, type Vec3 } from "@connect6/shared";

/**
 * Replay store — allows stepping through game history by turns.
 * Turn structure: Turn 0 = move 0 (Black, 1 stone), Turn 1 = moves 1-2 (White), Turn 2 = moves 3-4 (Black), ...
 */

interface ReplayState {
  /** Current move index: 0 = empty board, 1 = after move 0, 3 = after moves 0-2, ... */
  viewIndex: number;
  /** Total number of moves */
  totalMoves: number;
  /** Whether we're viewing the latest state (live mode) */
  isLive: boolean;
}

const initialState: ReplayState = {
  viewIndex: 0,
  totalMoves: 0,
  isLive: true,
};

let state: ReplayState = { ...initialState };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(partial: Partial<ReplayState>) {
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

/**
 * Get the move index at the END of a given turn.
 * Turn 0 → 1 (after Black's 1 stone)
 * Turn 1 → 3 (after White's 2 stones)
 * Turn 2 → 5 (after Black's 2 stones)
 * Turn n → n === 0 ? 1 : 2*n + 1
 */
function turnEndIndex(turn: number): number {
  return turn === 0 ? 1 : 2 * turn + 1;
}

/**
 * Get the turn number from a move index.
 * Move 0 → turn 0
 * Moves 1-2 → turn 1
 * Moves 3-4 → turn 2
 */
function moveIndexToTurn(idx: number): number {
  if (idx <= 0) return 0;
  return Math.floor((idx - 1) / 2) + 1;
}

/**
 * Get the next turn's end index from current viewIndex.
 * viewIndex is the number of moves displayed (not a move index).
 * 0 → 1 (after turn 0: 1 stone)
 * 1 → 3 (after turn 1: 2 more stones)
 * 3 → 5 (after turn 2: 2 more stones)
 */
function nextTurnIndex(current: number, max: number): number {
  if (current === 0) return Math.min(1, max);
  // current is the count of displayed moves; last displayed move is at index current-1
  const lastMoveTurn = moveIndexToTurn(current - 1);
  return Math.min(turnEndIndex(lastMoveTurn + 1), max);
}

/**
 * Get the previous turn's end index from current viewIndex.
 * 5 → 3, 3 → 1, 1 → 0
 */
function prevTurnIndex(current: number): number {
  if (current <= 0) return 0;
  if (current === 1) return 0;
  // current is the count of displayed moves; last displayed move is at index current-1
  const lastMoveTurn = moveIndexToTurn(current - 1);
  return turnEndIndex(lastMoveTurn - 1);
}

/** Update total moves from game snapshot */
export function updateReplayMoves(moves: Vec3[]) {
  const totalMoves = moves.length;
  if (state.isLive) {
    setState({ totalMoves, viewIndex: totalMoves });
  } else {
    setState({ totalMoves, viewIndex: Math.min(state.viewIndex, totalMoves) });
  }
}

/** Compute the board state at a given view index */
export function getReplayBoard(snapshot: SerializedState, viewIndex: number): number[] {
  const { config, moves } = snapshot;
  const board = new Array(config.sizeX * config.sizeY * config.sizeZ).fill(Stone.EMPTY);

  for (let i = 0; i < Math.min(viewIndex, moves.length); i++) {
    const move = moves[i];
    const isBlack = i === 0 || (Math.floor((i - 1) / 2) % 2 === 1);
    const idx = move.z * config.sizeY * config.sizeX + move.y * config.sizeX + move.x;
    board[idx] = isBlack ? Stone.BLACK : Stone.WHITE;
  }

  return board;
}

export function useReplayState(): ReplayState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useReplayActions() {
  const goBack = useCallback(() => {
    const newIndex = prevTurnIndex(state.viewIndex);
    setState({ viewIndex: newIndex, isLive: newIndex >= state.totalMoves });
  }, []);

  const goForward = useCallback(() => {
    const newIndex = nextTurnIndex(state.viewIndex, state.totalMoves);
    setState({ viewIndex: newIndex, isLive: newIndex >= state.totalMoves });
  }, []);

  const goLatest = useCallback(() => {
    setState({ viewIndex: state.totalMoves, isLive: true });
  }, []);

  return { goBack, goForward, goLatest };
}
