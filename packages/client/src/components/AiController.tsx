import { useEffect, useRef } from "react";
import { Player, Stone, type AiRequestPayload, type AiResponsePayload, type AiModelId } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";
import { useAiWorker } from "../hooks/useAiWorker";
import { API_BASE } from "../config";

const AI_API_TIMEOUT = 120_000; // 2 minutes

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

interface AiControllerProps {
  aiColor: Player;
  model: AiModelId;
  onAiSource?: (source: "llm" | "local") => void;
  onThinking?: (thinking: boolean) => void;
}

export function AiController({ aiColor, model, onAiSource, onThinking }: AiControllerProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const { compute: computeAiWorker } = useAiWorker();
  const busyRef = useRef(false);
  const genRef = useRef(0);

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
    genRef.current++;
    const myGen = genRef.current;
    onThinking?.(true);

    const placeMoves = (moves: { x: number; y: number; z: number }[]) => {
      if (genRef.current !== myGen) return;
      for (const move of moves) {
        placeStone(move.x, move.y, move.z);
      }
      busyRef.current = false;
      onThinking?.(false);
    };

    const onError = () => {
      if (genRef.current !== myGen) return;
      busyRef.current = false;
      onThinking?.(false);
    };

    if (model === "local") {
      // Local AI via Web Worker — no main thread blocking
      computeAiWorker(req).then((result) => {
        onAiSource?.("local");
        placeMoves(result.moves);
      }).catch(onError);
    } else {
      // LLM AI via server — async fetch
      callServerAi(req).then((serverResult) => {
        if (genRef.current !== myGen) return;
        const moves = serverResult?.moves ?? [];
        const usedLlm = moves.length > 0;
        onAiSource?.(usedLlm ? "llm" : "local");

        if (moves.length > 0) {
          placeMoves(moves);
        } else {
          // LLM failed — fallback to local via Worker
          computeAiWorker(req).then((localResult) => {
            onAiSource?.("local");
            placeMoves(localResult.moves);
          }).catch(onError);
        }
      }).catch(() => {
        // Network error — fallback to local
        computeAiWorker(req).then((localResult) => {
          onAiSource?.("local");
          placeMoves(localResult.moves);
        }).catch(onError);
      });
    }
  }, [snapshot, aiColor, model, placeStone, onAiSource, onThinking]);

  return null;
}
