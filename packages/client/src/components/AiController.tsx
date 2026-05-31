import { useEffect, useRef } from "react";
import { computeAiMove, Player, Stone, type AiRequestPayload, type AiResponsePayload, type AiModelId } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";

interface AiControllerProps {
  aiColor: Player;
  model: AiModelId;
}

const AI_API_TIMEOUT = 12000;
const API_BASE = import.meta.env.VITE_API_URL || "";

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

/**
 * Auto-plays for the AI when it's the AI's turn.
 * If model is "local", uses client-side Dummy AI directly.
 * Otherwise, calls server LLM endpoint with local fallback.
 */
export function AiController({ aiColor, model }: AiControllerProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
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

    const timer = setTimeout(async () => {
      try {
        let moves: { x: number; y: number; z: number }[] = [];

        if (model === "local") {
          // Local Dummy AI — no network
          const result = computeAiMove(req);
          moves = result.moves;
        } else {
          // Try server LLM endpoint
          const serverResult = await callServerAi(req);
          moves = serverResult?.moves ?? [];

          // Fallback to local if server fails
          if (moves.length === 0) {
            const localResult = computeAiMove(req);
            moves = localResult.moves;
          }
        }

        for (const move of moves) {
          placeStone(move.x, move.y, move.z);
        }
      } catch {
        // Emergency fallback
        const localResult = computeAiMove(req);
        for (const move of localResult.moves) {
          placeStone(move.x, move.y, move.z);
        }
      } finally {
        busyRef.current = false;
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [snapshot, aiColor, model, placeStone]);

  return null;
}
