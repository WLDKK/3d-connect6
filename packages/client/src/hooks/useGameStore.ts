import { createContext, useContext, useCallback, useRef, useSyncExternalStore } from "react";
import { Connect6Engine, type SerializedState } from "@connect6/shared";
import { Stone, Vec3 } from "@connect6/shared";

/** Callback to send a move to the server in multiplayer mode */
type SendMoveFn = (x: number, y: number, z: number) => void;

/** Minimal external-store-based game state — no re-render on every frame */
function createGameStore() {
  const engine = new Connect6Engine();
  let snapshot = engine.toJSON();
  const listeners = new Set<() => void>();
  let sendMoveFn: SendMoveFn | null = null;

  function emit() {
    snapshot = engine.toJSON();
    listeners.forEach((l) => l());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Place a stone — in multiplayer mode sends to server, in local mode applies directly */
    placeStone(x: number, y: number, z: number): boolean {
      if (sendMoveFn) {
        // Multiplayer: send to server, don't apply locally
        sendMoveFn(x, y, z);
        return true;
      }
      // Local: apply directly
      const ok = engine.placeStone(x, y, z);
      if (ok) emit();
      return ok;
    },
    getStone(x: number, y: number, z: number): Stone {
      return engine.getStone(x, y, z);
    },
    get engine() {
      return engine;
    },
    reset() {
      const newEngine = new Connect6Engine(engine.config);
      Object.assign(engine, newEngine);
      emit();
    },
    /** Load state from server snapshot (used in multiplayer) */
    loadState(state: SerializedState) {
      const restored = Connect6Engine.fromJSON(state);
      Object.assign(engine, restored);
      emit();
    },
    /** Set the multiplayer move sender. Pass null to revert to local mode. */
    setSendMove(fn: SendMoveFn | null) {
      sendMoveFn = fn;
    },
  };
}

type GameStore = ReturnType<typeof createGameStore>;

const GameStoreContext = createContext<GameStore | null>(null);

export { GameStoreContext };

/** Read-only hook that subscribes to game state */
export function useGameSnapshot(): SerializedState {
  const store = useContext(GameStoreContext);
  if (!store) throw new Error("useGameSnapshot must be inside GameStoreProvider");
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Hook that returns actions (stable references, no re-render) */
export function useGameActions() {
  const store = useContext(GameStoreContext);
  if (!store) throw new Error("useGameActions must be inside GameStoreProvider");

  const placeStone = useCallback(
    (x: number, y: number, z: number) => store.placeStone(x, y, z),
    [store],
  );
  const reset = useCallback(() => store.reset(), [store]);
  const loadState = useCallback(
    (state: SerializedState) => store.loadState(state),
    [store],
  );
  const setSendMove = useCallback(
    (fn: SendMoveFn | null) => store.setSendMove(fn),
    [store],
  );

  return { placeStone, reset, loadState, setSendMove };
}

/** Create a new store instance (for provider) */
export function useCreateGameStore() {
  const ref = useRef<GameStore | null>(null);
  if (!ref.current) {
    ref.current = createGameStore();
  }
  return ref.current;
}
