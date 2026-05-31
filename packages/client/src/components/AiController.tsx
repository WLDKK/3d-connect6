import { useEffect, useRef } from "react";
import { computeAiMove, computeAiMoveWithMemory, Player, Stone, type AiRequestPayload, type AiResponsePayload, type AiModelId } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";
import { useAiMemory } from "../hooks/useAiMemory";

interface AiControllerProps {
  aiColor: Player;
  model: AiModelId;
  /** Callback to report which AI was used for the last move */
  onAiSource?: (source: "llm" | "local") => void;
  /** Callback to report thinking state */
  onThinking?: (thinking: boolean) => void;
}

const AI_API_TIMEOUT = 300000; // 5 minutes
const API_BASE = import.meta.env.VITE_API_URL || (location.hostname.includes("pages.dev")
  ? "https://connect6-server.1310205058.workers.dev"
  : "");

async function callServerAi(req: AiRequestPayload): Promise<AiResponsePayload | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_API_TIMEOUT);

    const res = await fetch(`${API_BASE}/api/ai/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AiController({ aiColor, model, onAiSource, onThinking }: AiControllerProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const memory = useAiMemory();
  const busyRef = useRef(false);

  useEffect(() => {
    if (snapshot.winner !== Stone.EMPTY) return;
    if (snapshot.currentPlayer !== aiColor) return;
    if (busyRef.current) return;

    const stonesToPlace = snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn;
    if (stonesToPlace <= 0) return;

    const req: AiRequestPayload = {
      board: Array.from(snapshot.board),
      config: snapshot.config,
      aiColor,
      currentPlayer: snapshot.currentPlayer as Player,
      stonesToPlace,
      model,
    };

    busyRef.current = true;
    onThinking?.(true);

    const timer = setTimeout(async () => {
      try {
        let moves: { x: number; y: number; z: number }[] = [];
        let usedLlm = false;

        if (model === "local") {
          // Local AI with memory enhancement
          const result = computeAiMoveWithMemory(req, memory);
          moves = result.moves;
        } else {
          const serverResult = await callServerAi(req);
          moves = serverResult?.moves ?? [];
          usedLlm = moves.length > 0;

          if (moves.length === 0) {
            const localResult = computeAiMoveWithMemory(req, memory);
            moves = localResult.moves;
          }
        }

        onAiSource?.(usedLlm ? "llm" : "local");

        for (const move of moves) {
          placeStone(move.x, move.y, move.z);
        }
      } catch {
        onAiSource?.("local");
        const localResult = computeAiMoveWithMemory(req, memory);
        for (const move of localResult.moves) {
          placeStone(move.x, move.y, move.z);
        }
      } finally {
        busyRef.current = false;
        onThinking?.(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [snapshot, aiColor, model, placeStone, onAiSource, onThinking]);

  return null;
}
