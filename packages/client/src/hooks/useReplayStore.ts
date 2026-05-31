import { useSyncExternalStore, useCallback } from "react";
import { type SerializedState, Stone, type Vec3 } from "@connect6/shared";

/**
 * Replay store — allows stepping through game history.
 * Works with the game store's snapshot.moves to reconstruct board states.
 */

interface ReplayState {
  /** Current view index: -1 = empty board, 0..n-1 = after move i, n = latest (live) */
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

/** Update total moves from game snapshot */
export function updateReplayMoves(moves: Vec3[]) {
  const totalMoves = moves.length;
  if (state.isLive) {
    setState({ totalMoves, viewIndex: totalMoves });
  } else {
    // Clamp viewIndex to valid range
    setState({ totalMoves, viewIndex: Math.min(state.viewIndex, totalMoves) });
  }
}

/** Compute the board state at a given view index */
export function getReplayBoard(snapshot: SerializedState, viewIndex: number): number[] {
  const { config, moves } = snapshot;
  const board = new Array(config.sizeX * config.sizeY * config.sizeZ).fill(Stone.EMPTY);

  for (let i = 0; i < Math.min(viewIndex, moves.length); i++) {
    const move = moves[i];
    // Connect6: move 0 = Black, moves 1-2 = White, moves 3-4 = Black, ...
    const isBlack = i === 0 || (Math.floor((i - 1) / 2) % 2 === 1);
    const idx = move.z * config.sizeY * config.sizeX + move.y * config.sizeX + move.x;
    board[idx] = isBlack ? Stone.BLACK : Stone.WHITE;
  }

  return board;
}

/** Get the current player at a given view index */
export function getReplayPlayer(viewIndex: number): number {
  if (viewIndex === 0) return Stone.BLACK; // Round 0, Black goes first
  // After move 0: White's turn (moves 1-2), after moves 1-2: Black's turn (moves 3-4), ...
  const isBlack = viewIndex === 0 || (Math.floor((viewIndex - 1) / 2) % 2 === 1);
  return isBlack ? Stone.BLACK : Stone.WHITE;
}

export function useReplayState(): ReplayState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useReplayActions() {
  const goBack = useCallback(() => {
    if (state.viewIndex > 0) {
      setState({ viewIndex: state.viewIndex - 1, isLive: false });
    }
  }, []);

  const goForward = useCallback(() => {
    if (state.viewIndex < state.totalMoves) {
      const newIndex = state.viewIndex + 1;
      setState({ viewIndex: newIndex, isLive: newIndex >= state.totalMoves });
    }
  }, []);

  const goLatest = useCallback(() => {
    setState({ viewIndex: state.totalMoves, isLive: true });
  }, []);

  return { goBack, goForward, goLatest };
}
