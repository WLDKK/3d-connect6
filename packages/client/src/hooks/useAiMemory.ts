import { useSyncExternalStore, useCallback } from "react";
import { AiMemory, type MemoryData, type GameRecord, type SerializedState } from "@connect6/shared";
import { Player, Stone } from "@connect6/shared";

const STORAGE_KEY = "connect6-ai-memory";

/** Load memory from localStorage */
function loadMemory(): AiMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as MemoryData;
      return new AiMemory(data);
    }
  } catch { /* corrupted data */ }
  return new AiMemory();
}

/** Save memory to localStorage */
function saveMemory(memory: AiMemory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory.toJSON()));
  } catch { /* storage full */ }
}

// Singleton memory instance
let memory = loadMemory();
let cachedStats = memory.stats;
const listeners = new Set<() => void>();

function emit() {
  cachedStats = memory.stats;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return memory;
}

/**
 * Learn from a completed game.
 * Call this when a game ends (winner is determined).
 */
export function learnFromGame(state: SerializedState) {
  if (state.winner === Stone.EMPTY) return;

  const record: GameRecord = {
    moves: state.moves,
    winner: state.winner,
  };

  memory.learn(record, state.config);
  saveMemory(memory);
  emit();
}

/** Get current memory stats */
export function getMemoryStats() {
  return memory.stats;
}

/** Reset all memory */
export function resetMemory() {
  memory = new AiMemory();
  saveMemory(memory);
  emit();
}

/** Hook to access memory from React components */
export function useAiMemory(): AiMemory {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Hook to get memory stats (reactive) */
export function useMemoryStats(): { entries: number; totalGames: number } {
  return useSyncExternalStore(subscribe, () => cachedStats, () => cachedStats);
}

/** Hook to get memory actions */
export function useAiMemoryActions() {
  return {
    learn: useCallback((state: SerializedState) => learnFromGame(state), []),
    reset: useCallback(() => resetMemory(), []),
  };
}
